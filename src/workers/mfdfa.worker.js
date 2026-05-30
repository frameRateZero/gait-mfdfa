/**
 * src/workers/mfdfa.worker.js
 * ===========================
 * Isolated Single-Channel Web Worker — GAIT MFDFA Pipeline.
 */

let loadPyodide = null;

async function ensurePyodide() {
  if (!loadPyodide) {
    const mod = await import("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs");
    loadPyodide = mod.loadPyodide;
  }
}

let pyodide = null;
let pyReady = false;

async function initPyodide() {
  await ensurePyodide();
  self.postMessage({ type: "progress", stage: "loading_python", pct: 5 });

  pyodide = await loadPyodide();
  await pyodide.loadPackage(["numpy", "scipy", "micropip"]);

  await pyodide.runPythonAsync(`
import micropip
await micropip.install("MFDFA")
`);

  pyReady = true;
  self.postMessage({ type: "ready" });
}

self.onmessage = async (event) => {
  const { type, payload } = event.data;
  if (type === "run_channel") {
    try {
      if (!pyReady) await initPyodide();
      await computeChannel(payload);
    } catch (err) {
      self.postMessage({ type: "error", message: err.message || String(err) });
    }
  }
};

async function computeChannel({ channelName, rawDataBundle, pipelineSrc, mfdfaSrc, analysisSrc }) {
  self.postMessage({ type: "progress", stage: "loading_modules", channel: channelName, pct: 15 });

  // Load python definitions
  await pyodide.runPythonAsync(pipelineSrc);
  await pyodide.runPythonAsync(mfdfaSrc);
  await pyodide.runPythonAsync(analysisSrc);

  // Bind the full data streams into this worker's heap instance
  pyodide.globals.set("_ax_raw", new Float64Array(rawDataBundle.ax));
  pyodide.globals.set("_ay_raw", new Float64Array(rawDataBundle.ay));
  pyodide.globals.set("_az_raw", new Float64Array(rawDataBundle.az));
  pyodide.globals.set("_gx_raw", new Float64Array(rawDataBundle.gx));
  pyodide.globals.set("_gy_raw", new Float64Array(rawDataBundle.gy));
  pyodide.globals.set("_gz_raw", new Float64Array(rawDataBundle.gz));
  pyodide.globals.set("_ch_name", channelName);

  const progressFn = (iSurr, nSurr) => {
    const pct = Math.round(20 + 75 * (iSurr / nSurr));
    self.postMessage({
      type: "progress",
      stage: "surrogates",
      channel: channelName,
      surrogate: iSurr,
      n_surrogates: nSurr,
      pct,
    });
  };
  pyodide.globals.set("_js_progress_cb", progressFn);

  await pyodide.runPythonAsync(`
import json as _json
import numpy as np

# 1. Apply your exact X-axis geometric tilt correction definition
_aligned = correct_tilt_horizontal(
    _ax_raw.to_py(), _ay_raw.to_py(), _az_raw.to_py(),
    _gx_raw.to_py(), _gy_raw.to_py(), _gz_raw.to_py(),
    fs=100.0
)

# Extract our target tracking signal
_signal_100 = _aligned[_ch_name]

# 2. Downsample target signal from 100Hz to 50Hz to preserve microstructures
_signal_50 = downsample_50hz(_signal_100.tolist(), fs_in=100.0)

# 3. Run MFDFA execution loop
_ch_result = run_channel_mfdfa(
    _signal_50,
    n_surrogates=19,
    base_seed=42,
    fs=50.0,
    order=2,
    n_lags=80,
    scale_min_s=0.3,
    scale_max_s=30.0,
    progress_cb=lambda i, n: _js_progress_cb(i, n),
)

# Bundle geometric curves for the main dashboard UI
_ch_result["aligned_slice"] = _signal_100.tolist()[:2000] # return first 20s segment for line rendering
_ch_result_json = _json.dumps(_ch_result)
`);

  const chResult = JSON.parse(pyodide.globals.get("_ch_result_json"));

  self.postMessage({
    type: "channel_result",
    channelName,
    data: chResult
  });
}

initPyodide().catch((err) => {
  self.postMessage({ type: "error", message: `Init failed: ${err.message}` });
});
