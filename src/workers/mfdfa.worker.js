/**
 * src/workers/mfdfa.worker.js
 * ===========================
 * Pyodide Web Worker — GAIT MFDFA pipeline.
 *
 * Inbound:  { type: 'run', payload: { zipBytes: ArrayBuffer, metadata: object } }
 * Outbound: { type: 'ready' }
 *           { type: 'progress', stage, channel?, pct, surrogate?, n_surrogates? }
 *           { type: 'result', sessionResult }
 *           { type: 'error', message }
 */

// ── Pyodide CDN (pinned version) ─────────────────────────────────────────────
// ESM workers must use dynamic import() — importScripts() is not available.
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
  self.postMessage({ type: "progress", stage: "loading_python", pct: 1 });

  pyodide = await loadPyodide();

  self.postMessage({ type: "progress", stage: "loading_python", pct: 3 });

  await pyodide.loadPackage(["numpy", "scipy", "micropip"]);

  self.postMessage({ type: "progress", stage: "loading_python", pct: 7 });

  await pyodide.runPythonAsync(`
import micropip
await micropip.install("MFDFA")
`);

  self.postMessage({ type: "progress", stage: "loading_python", pct: 10 });

  pyReady = true;
  self.postMessage({ type: "ready" });
}

// ── Load Python source from public/python/ ───────────────────────────────────
function getPythonBase() {
  const workerPath = self.location.pathname;
  const m = workerPath.match(/^(\/[^/]*\/?)(?:assets|src)\//);
  const base = m ? m[1] : "/";
  return self.location.origin + base + "python/";
}

async function loadPythonSource(filename) {
  const url = getPythonBase() + filename;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  return resp.text();
}

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (event) => {
  const { type, payload } = event.data;
  if (type === "run") {
    try {
      await runPipeline(payload);
    } catch (err) {
      self.postMessage({ type: "error", message: err.message || String(err) });
    }
  }
};

async function runPipeline({ zipBytes, metadata }) {
  if (!pyReady) await initPyodide();

  self.postMessage({ type: "progress", stage: "loading_python", pct: 11 });

  const [pipelineSrc, mfdfaSrc, analysisSrc] = await Promise.all([
    loadPythonSource("pipeline.py"),
    loadPythonSource("mfdfa_core.py"),
    loadPythonSource("analysis.py"),
  ]);

  await pyodide.runPythonAsync(pipelineSrc);
  await pyodide.runPythonAsync(mfdfaSrc);
  await pyodide.runPythonAsync(analysisSrc);

  self.postMessage({ type: "progress", stage: "parsing_zip", pct: 12 });

  pyodide.globals.set("_zip_bytes_js", new Uint8Array(zipBytes));
  await pyodide.runPythonAsync(`
import json as _json
_zip_bytes_py = bytes(_zip_bytes_js.to_py())
_aligned = load_and_align(_zip_bytes_py, target_hz=100.0, gps_accuracy_max=20.0, trim_s=60.0)
`);

  self.postMessage({ type: "progress", stage: "tilt_corrected", pct: 14 });

  const CHANNELS = ["a_VT", "a_ML", "a_AP", "g_YAW", "g_ROLL", "g_PITCH"];
  const channelResults = {};
  const N_CH = CHANNELS.length;
  const PCT_PER_CH = (96 - 15) / N_CH;

  for (let ci = 0; ci < N_CH; ci++) {
    const ch = CHANNELS[ci];
    const basePct = 15 + ci * PCT_PER_CH;

    self.postMessage({ type: "progress", stage: "mfdfa", channel: ch, pct: Math.round(basePct) });

    pyodide.globals.set("_ch_name", ch);
    pyodide.globals.set("_base_pct_js", basePct);
    pyodide.globals.set("_pct_per_ch_js", PCT_PER_CH);

    const progressFn = (iSurr, nSurr) => {
      const pct = basePct + PCT_PER_CH * (iSurr / nSurr);
      self.postMessage({
        type: "progress",
        stage: "surrogates",
        channel: ch,
        surrogate: iSurr,
        n_surrogates: nSurr,
        pct: Math.round(pct),
      });
    };
    pyodide.globals.set("_js_progress_cb", progressFn);

    await pyodide.runPythonAsync(`
import json as _json

_sig_50 = downsample_50hz(_aligned[_ch_name], fs_in=100.0)

def _py_progress_cb(i, n):
    _js_progress_cb(i, n)

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

    const chJson = pyodide.globals.get("_ch_result_json");
    const chResult = JSON.parse(chJson);
    chResult.scalars.mf_class = classifyMF(chResult.scalars);
    channelResults[ch] = chResult;

    self.postMessage({ type: "progress", stage: "channel_done", channel: ch,
                       pct: Math.round(basePct + PCT_PER_CH) });
  }

  await pyodide.runPythonAsync(`
_aligned_summary = {
    "time":        _aligned["time"],
    "a_VT":        _aligned["a_VT"],
    "a_ML":        _aligned["a_ML"],
    "a_AP":        _aligned["a_AP"],
    "g_ROLL":      _aligned["g_ROLL"],
    "g_PITCH":     _aligned["g_PITCH"],
    "g_YAW":       _aligned["g_YAW"],
    "a_VT_zeroed": _aligned["a_VT_zeroed"],
    "velocity":    _aligned["velocity"],
    "duration_s":  _aligned["duration_s"],
    "n_samples":   _aligned["n_samples"],
}
_aligned_summary_json = _json.dumps(_aligned_summary)
`);

  const alignedJson = pyodide.globals.get("_aligned_summary_json");
  const aligned = JSON.parse(alignedJson);

  const sessionResult = {
    metadata,
    session_id:   metadata.session_id,
    processed_at: new Date().toISOString(),
    channels:     channelResults,
    aligned,
  };

  self.postMessage({ type: "result", sessionResult });
}

// ── Classification (mirrors analysis.py) ─────────────────────────────────────
function classifyMF(row) {
  const { robust, delta_alpha, delta_alpha_nl, p_iaaft, asymmetry } = row;
  if (!robust) {
    if ((asymmetry || 0) > 0.1 && (delta_alpha_nl || 0) < 0)
      return "smoothed_constrained";
    return "unclassified";
  }
  const isMF = (delta_alpha || 0) > 0.1;
  const isNL = (delta_alpha_nl || 0) > 0.1 && (p_iaaft || 1) < 0.05;
  if (!isMF) return "monofractal";
  if (isNL)  return "nonlinear_multifractal";
  return "linear_multifractal";
}

// ── Auto-init on worker load ──────────────────────────────────────────────────
initPyodide().catch((err) => {
  self.postMessage({
    type: "error",
    message: `Pyodide init failed: ${err.message || String(err)}`,
  });
});
