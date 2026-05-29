"""
pipeline.py
===========
Phyphox zip → tilt-corrected, trimmed DataFrame (as dict of lists).

Confirmed Phyphox CSV column headers (from real export):
  Accelerometer.csv : "Time (s)", "X (m/s^2)", "Y (m/s^2)", "Z (m/s^2)"
  Gyroscope.csv     : "Time (s)", "X (rad/s)",  "Y (rad/s)",  "Z (rad/s)"
  Location.csv      : "Time (s)", "Latitude (°)", "Longitude (°)",
                      "Height (m)", "Velocity (m/s)", "Direction (°)",
                      "Horizontal Accuracy (m)", "Vertical Accuracy (°)"

Values use scientific notation e.g. 9.095535736E0.
NaN values appear in Velocity and Direction during early GPS acquisition.
"""

import io
import zipfile
import math
import numpy as np


# ── CSV parser ────────────────────────────────────────────────────────────────

def _parse_phyphox_csv(data: bytes):
    """
    Parse a Phyphox CSV from bytes.
    Returns (n_rows, n_cols) float64 ndarray.
    NaN strings handled; header row skipped.
    """
    text  = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    rows  = []
    for line in lines[1:]:       # skip header
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        vals  = []
        for p in parts:
            p = p.strip().strip('"')
            try:
                vals.append(float(p))
            except ValueError:
                vals.append(float("nan"))
        if len(vals) >= 2:
            rows.append(vals)
    return np.array(rows, dtype=np.float64)


# ── Zip loading ───────────────────────────────────────────────────────────────

def _find_in_zip(zf, suffix):
    """Return the zip entry whose name ends with `suffix`."""
    for name in zf.namelist():
        if name.endswith(suffix):
            return name
    raise FileNotFoundError(
        f"{suffix!r} not found in zip. Contents: {zf.namelist()}"
    )


# ── Interpolation helpers ─────────────────────────────────────────────────────

def _interp(t_src, x_src, t_grid):
    """Linear interpolation; clamps at edges."""
    return np.interp(t_grid, t_src, x_src)


def _interp_circular_deg(t_src, deg_src, t_grid):
    """Circular interpolation for angular values (degrees, wraps at 360)."""
    # Replace NaN direction with 0 before interpolation
    deg_clean = np.where(np.isfinite(deg_src), deg_src, 0.0)
    rad   = np.deg2rad(deg_clean)
    sin_i = np.interp(t_grid, t_src, np.sin(rad))
    cos_i = np.interp(t_grid, t_src, np.cos(rad))
    return np.rad2deg(np.arctan2(sin_i, cos_i)) % 360.0


# ── Tilt correction ───────────────────────────────────────────────────────────

def correct_tilt_horizontal(ax_raw, ay_raw, az_raw, gx_raw, gy_raw, gz_raw, fs=100.0):
    """
    Static tilt correction using the quietest 5-second window.
    Exact port of the Colab notebook function.

    Returns dict of 1-D numpy arrays:
        a_VT, a_ML, a_AP, g_YAW, g_ROLL, g_PITCH
    """
    ax_raw = np.asarray(ax_raw, dtype=np.float64)
    ay_raw = np.asarray(ay_raw, dtype=np.float64)
    az_raw = np.asarray(az_raw, dtype=np.float64)
    gx_raw = np.asarray(gx_raw, dtype=np.float64)
    gy_raw = np.asarray(gy_raw, dtype=np.float64)
    gz_raw = np.asarray(gz_raw, dtype=np.float64)

    n     = len(ax_raw)
    win_n = int(5.0 * fs)
    step  = win_n // 2

    if n <= win_n:
        # File too short — use full-signal mean
        ax_s = float(np.mean(ax_raw))
        ay_s = float(np.mean(ay_raw))
        az_s = float(np.mean(az_raw))
        best_s, best_e = 0, n
    else:
        accel_mag = np.sqrt(ax_raw**2 + ay_raw**2 + az_raw**2)
        n_wins    = (n - win_n) // step
        variances = np.array([
            float(np.var(accel_mag[i*step : i*step + win_n]))
            for i in range(n_wins)
        ])
        best_win_idx = int(np.argmin(variances))
        best_s = best_win_idx * step
        best_e = best_s + win_n
        ax_s   = float(np.mean(ax_raw[best_s:best_e]))
        ay_s   = float(np.mean(ay_raw[best_s:best_e]))
        az_s   = float(np.mean(az_raw[best_s:best_e]))

    g_vector = np.array([ax_s, ay_s, az_s])
    g_mag    = float(np.linalg.norm(g_vector))
    z_axis   = g_vector / g_mag   # unit vector pointing down

    # Build orthogonal frame
    az_guide = np.array([0., 0., 1.]) if abs(z_axis[2]) < 0.9 else np.array([0., 1., 0.])
    x_axis   = np.cross(az_guide, z_axis)
    x_axis  /= np.linalg.norm(x_axis)
    y_axis   = np.cross(z_axis, x_axis)

    R = np.vstack([z_axis, x_axis, y_axis])   # (3, 3)

    # Rotate accelerometer
    accel_mat = np.vstack([ax_raw, ay_raw, az_raw])   # (3, n)
    accel_rot = (R @ accel_mat).T                      # (n, 3)

    a_VT = accel_rot[:, 0]
    if float(np.mean(a_VT[best_s:best_e])) < 0:
        a_VT           = -a_VT
        accel_rot[:, 2] = -accel_rot[:, 2]   # flip AP, keep right-handed

    # Rotate gyroscope with the same matrix
    gyro_mat = np.vstack([gx_raw, gy_raw, gz_raw])
    gyro_rot = (R @ gyro_mat).T

    return {
        "a_VT":   a_VT,
        "a_ML":   accel_rot[:, 1],
        "a_AP":   accel_rot[:, 2],
        "g_YAW":  gyro_rot[:, 0],
        "g_ROLL": gyro_rot[:, 1],
        "g_PITCH":gyro_rot[:, 2],
    }


# ── Downsampling ──────────────────────────────────────────────────────────────

def downsample_50hz(signal_100hz, fs_in=100.0):
    """
    Decimate a 100 Hz signal to 50 Hz via resample_poly(1, 2).
    Returns a Python list (JSON-serialisable).
    """
    from scipy.signal import resample_poly
    x = np.array(signal_100hz, dtype=np.float64, copy=True)
    return resample_poly(x, up=1, down=2).tolist()


# ── Main entry point ──────────────────────────────────────────────────────────

def load_and_align(
    zip_bytes: bytes,
    target_hz: float = 100.0,
    gps_accuracy_max: float = 20.0,
    trim_s: float = 60.0,
) -> dict:
    """
    Parse Phyphox zip → regular 100 Hz grid → tilt correction → trim.

    Returns a dict of Python lists (JSON-serialisable) plus scalar metadata.
    Keys:  time, ax, ay, az, gx, gy, gz,
           lat, lon, height, velocity, direction, h_acc,
           a_VT, a_ML, a_AP, g_YAW, g_ROLL, g_PITCH, a_VT_zeroed,
           fs_out (100.0), n_samples, duration_s
    """
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))

    accel_raw = _parse_phyphox_csv(zf.read(_find_in_zip(zf, "Accelerometer.csv")))
    gyro_raw  = _parse_phyphox_csv(zf.read(_find_in_zip(zf, "Gyroscope.csv")))
    loc_raw   = _parse_phyphox_csv(zf.read(_find_in_zip(zf, "Location.csv")))

    # Column layout (0-indexed):
    # accel: [time, X, Y, Z]
    # gyro:  [time, X, Y, Z]
    # loc:   [time, lat, lon, height, velocity, direction, h_acc, v_acc]

    dt = 1.0 / target_hz
    t0 = max(float(accel_raw[0, 0]), float(gyro_raw[0, 0]), float(loc_raw[0, 0]))
    t1 = min(float(accel_raw[-1, 0]), float(gyro_raw[-1, 0]), float(loc_raw[-1, 0]))
    t_grid = np.arange(t0, t1, dt)

    # Interpolate accel
    ax = _interp(accel_raw[:, 0], accel_raw[:, 1], t_grid)
    ay = _interp(accel_raw[:, 0], accel_raw[:, 2], t_grid)
    az = _interp(accel_raw[:, 0], accel_raw[:, 3], t_grid)

    # Interpolate gyro
    gx = _interp(gyro_raw[:, 0], gyro_raw[:, 1], t_grid)
    gy = _interp(gyro_raw[:, 0], gyro_raw[:, 2], t_grid)
    gz = _interp(gyro_raw[:, 0], gyro_raw[:, 3], t_grid)

    # GPS: filter rows where horizontal accuracy exceeds threshold
    # h_acc is column 6
    h_acc_col = loc_raw[:, 6]
    good_gps  = np.isfinite(h_acc_col) & (h_acc_col <= gps_accuracy_max)
    if good_gps.sum() >= 4:
        loc_clean = loc_raw[good_gps]
    else:
        loc_clean = loc_raw   # fallback: use all rows

    lat       = _interp(loc_clean[:, 0], loc_clean[:, 1], t_grid)
    lon       = _interp(loc_clean[:, 0], loc_clean[:, 2], t_grid)
    height    = _interp(loc_clean[:, 0], loc_clean[:, 3], t_grid)

    # Velocity may start as NaN — fill forward with nearest
    vel_src   = loc_clean[:, 4]
    vel_finite = np.isfinite(vel_src)
    if vel_finite.any():
        velocity = _interp(loc_clean[vel_finite, 0], vel_src[vel_finite], t_grid)
    else:
        velocity = np.zeros_like(t_grid)

    h_acc_out = _interp(loc_clean[:, 0], h_acc_col[good_gps] if good_gps.sum() >= 4 else h_acc_col, t_grid)

    # Direction (circular)
    dir_src    = loc_clean[:, 5]
    dir_finite = np.isfinite(dir_src)
    if dir_finite.any():
        direction = _interp_circular_deg(
            loc_clean[dir_finite, 0], dir_src[dir_finite], t_grid
        )
    else:
        direction = np.zeros_like(t_grid)

    # Trim 60 s each end
    n      = len(t_grid)
    trim_n = int(trim_s * target_hz)
    s_idx  = trim_n
    e_idx  = n - trim_n
    if e_idx <= s_idx:
        raise ValueError(
            f"Recording too short to trim {trim_s}s each end. "
            f"Total: {n / target_hz:.1f}s. Need > {2 * trim_s}s."
        )

    sl = slice(s_idx, e_idx)
    t_grid    = t_grid[sl]
    ax, ay, az = ax[sl], ay[sl], az[sl]
    gx, gy, gz = gx[sl], gy[sl], gz[sl]
    lat, lon, height = lat[sl], lon[sl], height[sl]
    velocity, h_acc_out, direction = velocity[sl], h_acc_out[sl], direction[sl]

    # Tilt correction
    aligned = correct_tilt_horizontal(ax, ay, az, gx, gy, gz, fs=target_hz)

    a_VT_zeroed = aligned["a_VT"] - float(np.median(aligned["a_VT"]))

    return {
        "time":       t_grid.tolist(),
        "ax": ax.tolist(), "ay": ay.tolist(), "az": az.tolist(),
        "gx": gx.tolist(), "gy": gy.tolist(), "gz": gz.tolist(),
        "lat": lat.tolist(), "lon": lon.tolist(), "height": height.tolist(),
        "velocity": velocity.tolist(), "direction": direction.tolist(),
        "h_acc": h_acc_out.tolist(),
        "a_VT":    aligned["a_VT"].tolist(),
        "a_ML":    aligned["a_ML"].tolist(),
        "a_AP":    aligned["a_AP"].tolist(),
        "g_YAW":   aligned["g_YAW"].tolist(),
        "g_ROLL":  aligned["g_ROLL"].tolist(),
        "g_PITCH": aligned["g_PITCH"].tolist(),
        "a_VT_zeroed": a_VT_zeroed.tolist(),
        "fs_out":    float(target_hz),
        "n_samples": int(len(t_grid)),
        "duration_s": float(len(t_grid) / target_hz),
    }
