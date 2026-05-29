# Gait MFDFA PWA

Phyphox IMU gait analysis app. Upload a Phyphox zip, fill the metadata form, run MFDFA in-browser via Pyodide Web Worker, store results in IndexedDB, view longitudinal plots.

## Stack
- **React 18** + **Vite 5** — no native app required
- **Pyodide 0.26** — CPython 3.11 in WASM, runs in a Web Worker
- **MFDFA** (PyPI) — installed at runtime via micropip
- **recharts** — longitudinal plots
- **IndexedDB** — all data stays on-device

## Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:5173/`

> **First load:** Pyodide (~8 MB) + MFDFA install takes ~30s on a good connection. Pyodide is cached by the service worker after the first visit.

## Deploy to GitHub Pages

1. Create a repo named `gait-mfdfa` under `frameRateZero`
2. Go to Settings → Pages → Source: **GitHub Actions**
3. Push to `main` — the Actions workflow builds and deploys automatically
4. App available at: `https://frameRateZero.github.io/gait-mfdfa/`

If your repo has a different name, set `VITE_BASE` in the workflow:
```yaml
env:
  VITE_BASE: /your-repo-name/
```

## Pipeline summary

```
Phyphox zip
  └─ Accelerometer.csv  "Time (s)", "X (m/s^2)", "Y (m/s^2)", "Z (m/s^2)"
  └─ Gyroscope.csv      "Time (s)", "X (rad/s)", "Y (rad/s)", "Z (rad/s)"
  └─ Location.csv       "Time (s)", "Latitude (°)", "Longitude (°)", ...

1. Interpolate to regular 100 Hz grid (linear, scipy-free)
2. Trim 60s each end
3. Tilt correction via quietest 5s window → a_VT, a_ML, a_AP, g_ROLL, g_PITCH, g_YAW
4. Downsample to 50 Hz (resample_poly factor 2)
5. MFDFA: DEFAULT_Q (±0.5..±5, 30 values), order=2, n_lags=80, scale 0.3–30s
6. 19 IAAFT surrogates (sequential — no joblib)
7. Legendre transform → H(q), τ(q), α(q), f(α)
8. Scalars: Δα, Δα_nl, α₀, asymmetry, f_max, H_q_range
9. Classification: nonlinear_multifractal / linear_multifractal / monofractal / unclassified / smoothed_constrained
```

## Primary outcome channels
| Channel | Anatomy | Stability |
|---------|---------|-----------|
| **a_ML** | Mediolateral acceleration | ★ Most stable |
| **g_ROLL** | Frontal plane rotation | ★ Most stable |
| **a_AP** | Anteroposterior acceleration | More variable |
| **g_PITCH** | Sagittal plane rotation | More variable |
| a_VT | Vertical acceleration | Context-dependent |
| g_YAW | Transverse rotation | Consistently unclassified |

## Reference values (healthy community walking)
- α₀: 0.6–0.9
- Continuous walking α₀: 0.35–0.55
- Negative asymmetry: healthy signature
- Δα: robustly nonlinear_multifractal for a_ML, a_AP, g_ROLL, g_PITCH

## Expected processing time
~3 minutes for all 6 channels at 50 Hz, n=19 surrogates, sequential (Pyodide).

## Data
All data stays in IndexedDB on the device. Nothing is uploaded to any server.
