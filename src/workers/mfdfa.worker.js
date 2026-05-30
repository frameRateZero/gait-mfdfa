/**
 * src/workers/mfdfa.worker.js
 * ===========================
 * Isolated Single-Channel Web Worker — GAIT MFDFA Pipeline.
 * * Process exactly one signal channel per lifecycle to completely eliminate
 * WebAssembly/C-extension memory layout contamination between axes.
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

  // Install MFDFA
  await pyodide.runPythonAsync(`
import micropip
await micropip.install("MFDFA")
import MFDFA as _mfdfa_pkg
`);

  pyReady = true;
  self.postMessage({ type: "ready" });
}

// Message Router
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

async function computeChannel({ channelName, signalData, pipelineSrc, mfdfaSrc, analysisSrc }) {
  self.postMessage({ type: "progress", stage: "initializing_channel", channel: channelName, pct: 15 });

  // Compile individual Python runtime scripts inside this isolated heap environment
  await pyodide.runPythonAsync(pipelineSrc);
  await pyodide.runPythonAsync(mfdfaSrc);
  await pyodide.runPythonAsync(analysisSrc);

  // Bind the specific 100Hz channel slice into Pyodide memory space
  pyodide.globals.set("_raw_signal_js", new Float64Array(signalData));
  pyodide.globals.set("_ch_name", channelName);

  // Set up the proxy-safe progress hook callback for the 19 surrogates
  const progressFn = (iSurr, nSurr) => {
    const basePct = 20;
    const availablePct = 75;
    const pct = basePct + availablePct * (iSurr / nSurr);
    self.postMessage({
      type: "progress",
      stage: "surrogates",
      channel: channelName,
      surrogate: iSurr,
      n_surrogates: nSurr,
      pct: Math.round(pct),
    });
  };
  pyodide.globals.set("_js_progress_cb", progressFn);

  await pyodide.runPythonAsync(`
import json as _json

# Convert proxy array into native 1D python list
_sig_list = _raw_signal_js.to_py()

# Decimate down to 50 Hz using pipeline logic
_sig_50 = downsample_50hz(_sig_list, fs_in=100.0)

def _py_progress_cb(i, n):
    _js_progress_cb(i, n)

# Run full MFDFA loop on clean, isolated environment heap
_ch_result = run_channel_mfdfa(
    _sig_50,
    n_surrogates=19,
    base_seed=42,
    fs=50.0,
    order=2,
    n_lags=80,
    scale_min_s=0.3,
    scale_max_s=30.0,
    progress_cb=_py_progress_cb,
)
_ch_result_json = _json.dumps(_ch_result)
`);

  const jsonResult = pyodide.globals.get("_ch_result_json");
  const chResult = JSON.parse(jsonResult);

  // Direct return to orchestrator
  self.postMessage({
    type: "channel_result",
    channelName,
    data: chResult
  });
}

// Auto-boot environment
initPyodide().catch((err) => {
  self.postMessage({ type: "error", message: `Init failed: ${err.message}` });
});
