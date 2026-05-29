"""
mfdfa_core.py
=============
compute_multifractal_spectrum(), run_channel_mfdfa(),
spectrum_scalars(), surrogate_iaaft(), surrogate_shuffle(), DEFAULT_Q

Ported from confirmed-working Colab notebook.
Pyodide constraints: no joblib — surrogates are sequential.
"""

import numpy as np
from MFDFA import MFDFA

# ── Default q range (no q=0) ──────────────────────────────────────────────────
DEFAULT_Q = np.concatenate([
    np.linspace(-5.0, -0.5, 15),   # negative q: large fluctuations
    np.linspace( 0.5,  5.0, 15),   # positive q: small fluctuations
])

# ── Surrogates ────────────────────────────────────────────────────────────────

def surrogate_shuffle(signal, rng=None):
    if rng is None:
        rng = np.random.default_rng()
    s = np.asarray(signal, dtype=np.float64).copy()
    rng.shuffle(s)
    return s


def surrogate_iaaft(signal, n_iter=100, rng=None):
    """IAAFT surrogate — sequential, safe for Pyodide."""
    if rng is None:
        rng = np.random.default_rng()
    x        = np.asarray(signal, dtype=np.float64)
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
        s      = x_sorted[ranks]
    return s.astype(np.float64)


# ── Core computation ──────────────────────────────────────────────────────────

def compute_multifractal_spectrum(
    signal,
    fs              = 50.0,
    order           = 2,
    q               = None,
    n_lags          = 80,
    scale_min_s     = 0.3,
    scale_max_s     = 30.0,
    surrogate_results = None,
    min_lags        = 16,
):
    signal = np.asarray(signal, dtype=np.float64)
    n      = len(signal)

    if q is None:
        q = DEFAULT_Q.copy()
    q = np.asarray(q, dtype=np.float64)

    max_lag   = n // 4
    lag_range = np.unique(np.logspace(1, np.log10(max_lag), n_lags).astype(int))
    if len(lag_range) < min_lags:
        raise ValueError(
            f"Signal too short: only {len(lag_range)} distinct lags "
            f"(need ≥{min_lags}). n={n}, max_lag={max_lag}."
        )

    lag, Fqs = MFDFA(signal, lag=lag_range, q=q, order=order)
    lag   = lag.flatten().astype(int)
    lag_s = lag / fs

    lo = scale_min_s if scale_min_s is not None else float(lag_s.min())
    hi = scale_max_s if scale_max_s is not None else float(lag_s.max())
    scale_mask = (lag_s >= lo) & (lag_s <= hi)

    if scale_mask.sum() < 4:
        raise ValueError(
            f"Fewer than 4 lag points in [{lo:.2f}, {hi:.2f}] s."
        )

    log_lag_fit = np.log2(lag_s[scale_mask])

    H_q = np.empty(len(q))
    for i in range(len(q)):
        log_F  = np.log2(Fqs[scale_mask, i])
        finite = np.isfinite(log_F)
        if finite.sum() >= 4:
            H_q[i] = float(np.polyfit(log_lag_fit[finite], log_F[finite], 1)[0])
        else:
            H_q[i] = np.nan

    tau_q   = q * H_q - 1.0
    alpha   = np.gradient(tau_q, q)
    f_alpha = q * alpha - tau_q

    valid = np.isfinite(f_alpha) & np.isfinite(alpha) & (f_alpha >= 0)
    if valid.sum() < 4:
        alpha_0 = f_max = delta_alpha = asymmetry = np.nan
    else:
        alpha_v     = alpha[valid]
        f_v         = f_alpha[valid]
        peak_idx    = int(np.argmax(f_v))
        alpha_0     = float(alpha_v[peak_idx])
        f_max       = float(f_v[peak_idx])
        delta_alpha = float(alpha_v.max() - alpha_v.min())
        asymmetry   = float((alpha_0 - alpha_v.min()) / (delta_alpha + 1e-10) - 0.5)

    if surrogate_results is not None:
        delta_alpha_nl = delta_alpha - surrogate_results.get("delta_alpha", np.nan)
    else:
        delta_alpha_nl = np.nan

    return {
        "q":               q,
        "H_q":             H_q,
        "tau_q":           tau_q,
        "alpha":           alpha,
        "f_alpha":         f_alpha,
        "alpha_0":         alpha_0,
        "f_max":           f_max,
        "delta_alpha":     delta_alpha,
        "asymmetry":       asymmetry,
        "delta_alpha_nl":  delta_alpha_nl,
        "lag_s":           lag_s,
        "Fqs":             Fqs,
        "scale_min_s":     lo,
        "scale_max_s":     hi,
    }


def _nan_to_none(v):
    """Convert float NaN → None for JSON serialisation."""
    if v is None:
        return None
    try:
        fv = float(v)
        return None if fv != fv else fv   # NaN check: NaN != NaN
    except Exception:
        return None


def spectrum_scalars(results):
    """Flat JSON-serialisable dict for one channel/session row."""
    H_q = results["H_q"]
    finite_H = H_q[np.isfinite(H_q)]
    h_range = float(finite_H.max() - finite_H.min()) if len(finite_H) > 0 else None

    return {
        "delta_alpha":    _nan_to_none(results["delta_alpha"]),
        "alpha_0":        _nan_to_none(results["alpha_0"]),
        "f_max":          _nan_to_none(results["f_max"]),
        "asymmetry":      _nan_to_none(results["asymmetry"]),
        "delta_alpha_nl": _nan_to_none(results["delta_alpha_nl"]),
        "H_q_range":      _nan_to_none(h_range),
    }


def run_channel_mfdfa(
    signal_50hz,
    n_surrogates  = 19,
    base_seed     = 42,
    fs            = 50.0,
    order         = 2,
    n_lags        = 80,
    scale_min_s   = 0.3,
    scale_max_s   = 30.0,
    progress_cb   = None,
):
    """
    Full per-channel pipeline:
      1. Real signal MFDFA
      2. n_surrogates IAAFT surrogates (sequential)
      3. Stats: p_iaaft, robust
    
    progress_cb(i, n_surrogates) called after each surrogate completes.
    Returns a JSON-serialisable dict.
    """
    sig = np.asarray(signal_50hz, dtype=np.float64)

    res = compute_multifractal_spectrum(
        sig, fs=fs, order=order, q=DEFAULT_Q.copy(),
        n_lags=n_lags, scale_min_s=scale_min_s, scale_max_s=scale_max_s,
    )

    surr_deltas    = []
    surr_res_list  = []
    for i in range(n_surrogates):
        rng  = np.random.default_rng(base_seed + i)
        surr = surrogate_iaaft(sig, rng=rng)
        sr   = compute_multifractal_spectrum(
            surr, fs=fs, order=order, q=DEFAULT_Q.copy(),
            n_lags=n_lags, scale_min_s=scale_min_s, scale_max_s=scale_max_s,
        )
        surr_deltas.append(sr["delta_alpha"])
        surr_res_list.append(sr)
        if progress_cb is not None:
            progress_cb(i + 1, n_surrogates)

    surr_deltas     = np.array(surr_deltas, dtype=np.float64)
    finite_surr     = surr_deltas[np.isfinite(surr_deltas)]
    mean_surr_delta = float(np.mean(finite_surr)) if len(finite_surr) > 0 else np.nan

    res["delta_alpha_nl"] = res["delta_alpha"] - mean_surr_delta

    p_iaaft = float(np.mean(surr_deltas >= res["delta_alpha"])) if len(finite_surr) > 0 else np.nan
    robust  = bool(len(finite_surr) > 0 and float(res["delta_alpha"]) > float(np.max(finite_surr)))

    scalars           = spectrum_scalars(res)
    scalars["p_iaaft"] = _nan_to_none(p_iaaft)
    scalars["robust"]  = robust

    # Median surrogate for overlay plot
    if len(finite_surr) > 0:
        median_idx   = int(np.argsort(surr_deltas)[len(surr_deltas) // 2])
        ms           = surr_res_list[median_idx]
        surr_alpha   = ms["alpha"].tolist()
        surr_f_alpha = ms["f_alpha"].tolist()
    else:
        surr_alpha = surr_f_alpha = []

    def _safe_list(arr):
        return [_nan_to_none(v) for v in arr]

    return {
        "scalars":      scalars,
        "q":            _safe_list(res["q"]),
        "H_q":          _safe_list(res["H_q"]),
        "tau_q":        _safe_list(res["tau_q"]),
        "alpha":        _safe_list(res["alpha"]),
        "f_alpha":      _safe_list(res["f_alpha"]),
        "alpha_0":      scalars["alpha_0"],
        "surr_alpha":   _safe_list(surr_alpha),
        "surr_f_alpha": _safe_list(surr_f_alpha),
        "scale_min_s":  float(res["scale_min_s"]),
        "scale_max_s":  float(res["scale_max_s"]),
    }
