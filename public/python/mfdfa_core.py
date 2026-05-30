"""
mfdfa_core.py  —  defensive-copy edition
=========================================
All numpy arrays are copied on entry and on return.
No shared mutable state between calls.
"""

import numpy as np
from MFDFA import MFDFA as _MFDFA_fn

# ── Default q range (no q=0) — immutable reference ───────────────────────────
DEFAULT_Q = np.concatenate([
    np.linspace(-5.0, -0.5, 15),
    np.linspace( 0.5,  5.0, 15),
])
DEFAULT_Q.flags.writeable = False   # make it read-only so mutations raise immediately


def _fresh_q(q=None):
    """Always return a fresh, writeable float64 copy of q."""
    if q is None:
        return DEFAULT_Q.astype(np.float64)          # .astype always copies
    return np.array(q, dtype=np.float64, copy=True)  # explicit copy


# ── Surrogates ────────────────────────────────────────────────────────────────

def surrogate_shuffle(signal, rng=None):
    if rng is None:
        rng = np.random.default_rng()
    s = np.array(signal, dtype=np.float64, copy=True)
    rng.shuffle(s)
    return s


def surrogate_iaaft(signal, n_iter=100, rng=None):
    """IAAFT surrogate — sequential, safe for Pyodide."""
    if rng is None:
        rng = np.random.default_rng()
    x        = np.array(signal, dtype=np.float64, copy=True)
    n        = len(x)
    x_sorted = np.sort(x)
    X_amp    = np.abs(np.fft.rfft(x))
    s        = rng.permutation(x)
    for _ in range(n_iter):
        S      = np.fft.rfft(s)
        phases = np.angle(S)
        S_new  = X_amp * np.exp(1j * phases)
        s      = np.fft.irfft(S_new, n=n)
        ranks  = np.argsort(np.argsort(s))
        s      = x_sorted[ranks].copy()   # copy so x_sorted is never mutated
    return s.astype(np.float64, copy=True)


# ── Core computation ──────────────────────────────────────────────────────────

def compute_multifractal_spectrum(
    signal,
    fs            = 50.0,
    order         = 2,
    q             = None,
    n_lags        = 80,
    scale_min_s   = 0.3,
    scale_max_s   = 30.0,
    min_lags      = 16,
):
    """
    Compute multifractal spectrum for a single signal.
    All inputs copied; returned dict contains only fresh arrays — no aliasing.
    """
    # ── defensive copies on entry ─────────────────────────────────────────
    sig = np.array(signal, dtype=np.float64, copy=True)
    q   = _fresh_q(q)
    n   = len(sig)

    # ── lag range ─────────────────────────────────────────────────────────
    max_lag   = n // 4
    lag_range = np.unique(
        np.logspace(1, np.log10(max_lag), n_lags).astype(int)
    )
    if len(lag_range) < min_lags:
        raise ValueError(
            f"Signal too short: only {len(lag_range)} distinct lags "
            f"(need ≥{min_lags}). n={n}, max_lag={max_lag}."
        )

    # ── MFDFA call — pass copies so the package cannot mutate our arrays ──
    lag, Fqs = _MFDFA_fn(
        sig.copy(), lag=lag_range.copy(), q=q.copy(), order=order
    )
    lag   = lag.flatten().astype(int).copy()
    Fqs   = np.array(Fqs, dtype=np.float64, copy=True)
    
    # ── DEFENSIVE SHAPE FIX ───────────────────────────────────────────────
    # Ensure Fqs is oriented as (n_lags, n_q) so that Fqs[scale_mask, i] 
    # correctly grabs the scale line for the i-th q. 
    # If rows match len(q) instead of lag_range, transpose it.
    if Fqs.shape[0] == len(q) and Fqs.shape[1] == len(lag_range):
        Fqs = Fqs.T
    # ──────────────────────────────────────────────────────────────────────

    lag_s = lag / float(fs)

    # ── scale window ──────────────────────────────────────────────────────
    lo = float(scale_min_s) if scale_min_s is not None else float(lag_s.min())
    hi = float(scale_max_s) if scale_max_s is not None else float(lag_s.max())
    scale_mask = (lag_s >= lo) & (lag_s <= hi)

    if scale_mask.sum() < 4:
        raise ValueError(
            f"Fewer than 4 lag points in [{lo:.2f}, {hi:.2f}] s. "
            f"lag_s range: [{lag_s.min():.2f}, {lag_s.max():.2f}]"
        )

    log_lag_fit = np.log2(lag_s[scale_mask].copy())

    # ── H(q): slope of log F(q,s) vs log s ───────────────────────────────
    H_q = np.full(len(q), np.nan, dtype=np.float64)
    for i in range(len(q)):
        log_F  = np.log2(Fqs[scale_mask, i].copy())
        finite = np.isfinite(log_F)
        if finite.sum() >= 4:
            coeffs = np.polyfit(log_lag_fit[finite], log_F[finite], 1)
            H_q[i] = float(coeffs[0])

    # ── Robust Native Legendre Transform ──────────────────────────────────
    # Calculate tau_q cleanly
    tau_q = q.copy() * H_q - 1.0
    
    # Calculate alpha and f_alpha using analytical difference spacing
    # to protect against WASM float precision gradient drift
    dq = np.diff(q)
    
    # Ensure q has uniform spacing for analytical derivative
    if np.allclose(dq, dq[0], atol=1e-5):
        # Clean analytical forward-difference derivative for stability
        alpha = np.zeros_like(tau_q)
        alpha[:-1] = np.diff(tau_q) / dq[0]
        # Backward difference for the terminal point
        alpha[-1] = (tau_q[-1] - tau_q[-2]) / dq[-1]
    else:
        # Fallback to standard gradient if q spacing is non-uniform
        alpha = np.gradient(tau_q, q)
        
    f_alpha = q * alpha - tau_q

    # ── Scalar extraction ─────────────────────────────────────────────────
    valid = np.isfinite(f_alpha) & np.isfinite(alpha) & (f_alpha >= 0)
    if valid.sum() < 4:
        alpha_0 = f_max = delta_alpha = asymmetry = np.nan
    else:
        alpha_v     = alpha[valid].copy()
        f_v         = f_alpha[valid].copy()
        peak_idx    = int(np.argmax(f_v))
        alpha_0     = float(alpha_v[peak_idx])
        f_max       = float(f_v[peak_idx])
        delta_alpha = float(alpha_v.max() - alpha_v.min())
        asymmetry   = float(
            (alpha_0 - float(alpha_v.min())) / (delta_alpha + 1e-10) - 0.5
        )

    # ── Return fresh copies only — no views, no aliases ──────────────────
    return {
        "q":           q.copy(),
        "H_q":         H_q.copy(),
        "tau_q":       tau_q.copy(),
        "alpha":       alpha.copy(),
        "f_alpha":     f_alpha.copy(),
        "alpha_0":     alpha_0,
        "f_max":       f_max,
        "delta_alpha": delta_alpha,
        "asymmetry":   asymmetry,
        "lag_s":       lag_s.copy(),
        "Fqs":         Fqs.copy(),
        "scale_min_s": lo,
        "scale_max_s": hi,
    }


def _nan_to_none(v):
    if v is None:
        return None
    try:
        fv = float(v)
        return None if (fv != fv) else fv
    except Exception:
        return None


def spectrum_scalars(results):
    H_q      = results["H_q"].copy()
    finite_H = H_q[np.isfinite(H_q)]
    h_range  = float(finite_H.max() - finite_H.min()) if len(finite_H) > 0 else None
    return {
        "delta_alpha":    _nan_to_none(results["delta_alpha"]),
        "alpha_0":        _nan_to_none(results["alpha_0"]),
        "f_max":          _nan_to_none(results["f_max"]),
        "asymmetry":      _nan_to_none(results["asymmetry"]),
        "delta_alpha_nl": _nan_to_none(results.get("delta_alpha_nl", np.nan)),
        "H_q_range":      _nan_to_none(h_range),
    }


def run_channel_mfdfa(
    signal_50hz,
    n_surrogates = 19,
    base_seed    = 42,
    fs           = 50.0,
    order        = 2,
    n_lags       = 80,
    scale_min_s  = 0.3,
    scale_max_s  = 30.0,
    progress_cb  = None,
):
    # Fresh copy of signal — never share with caller
    sig = np.array(signal_50hz, dtype=np.float64, copy=True)

    # ── Real signal ───────────────────────────────────────────────────────
    res = compute_multifractal_spectrum(
        sig.copy(), fs=fs, order=order, q=None,
        n_lags=n_lags, scale_min_s=scale_min_s, scale_max_s=scale_max_s,
    )

    # ── Surrogates — each gets its own fresh signal copy ──────────────────
    surr_deltas   = []
    surr_res_list = []
    for i in range(n_surrogates):
        rng  = np.random.default_rng(base_seed + i)
        surr = surrogate_iaaft(sig.copy(), rng=rng)
        sr   = compute_multifractal_spectrum(
            surr, fs=fs, order=order, q=None,
            n_lags=n_lags, scale_min_s=scale_min_s, scale_max_s=scale_max_s,
        )
        surr_deltas.append(float(sr["delta_alpha"]))
        surr_res_list.append(sr)
        if progress_cb is not None:
            progress_cb(i + 1, n_surrogates)

    surr_arr    = np.array(surr_deltas, dtype=np.float64)
    finite_surr = surr_arr[np.isfinite(surr_arr)]
    mean_surr   = float(np.mean(finite_surr)) if len(finite_surr) > 0 else np.nan

    delta_alpha_nl = float(res["delta_alpha"]) - mean_surr
    p_iaaft = (
        float(np.mean(surr_arr >= res["delta_alpha"]))
        if len(finite_surr) > 0 else np.nan
    )
    robust = bool(
        len(finite_surr) > 0
        and float(res["delta_alpha"]) > float(np.max(finite_surr))
    )

    scalars                  = spectrum_scalars(res)
    scalars["delta_alpha_nl"] = _nan_to_none(delta_alpha_nl)
    scalars["p_iaaft"]        = _nan_to_none(p_iaaft)
    scalars["robust"]         = robust

    # Median surrogate for overlay
    if len(finite_surr) > 0:
        median_idx   = int(np.argsort(surr_arr)[len(surr_arr) // 2])
        ms           = surr_res_list[median_idx]
        surr_alpha   = ms["alpha"].copy().tolist()
        surr_f_alpha = ms["f_alpha"].copy().tolist()
    else:
        surr_alpha = surr_f_alpha = []

    def _safe_list(arr):
        return [_nan_to_none(float(v)) for v in arr]

    return {
        "scalars":      scalars,
        "q":            _safe_list(res["q"]),
        "H_q":          _safe_list(res["H_q"]),
        "tau_q":        _safe_list(res["tau_q"]),
        "alpha":        _safe_list(res["alpha"]),
        "f_alpha":      _safe_list(res["f_alpha"]),
        "alpha_0":      scalars["alpha_0"],
        "surr_alpha":   [_nan_to_none(float(v)) for v in surr_alpha],
        "surr_f_alpha": [_nan_to_none(float(v)) for v in surr_f_alpha],
        "scale_min_s":  float(res["scale_min_s"]),
        "scale_max_s":  float(res["scale_max_s"]),
    }
