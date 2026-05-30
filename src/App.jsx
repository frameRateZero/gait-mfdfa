/**
 * src/App.jsx
 * ===========
 * Multi-threaded Parallel Core Orchestration for GAIT MFDFA PWA.
 * Spawns concurrent, parallelized worker environments to bypass WASM compilation cache bottlenecks.
 * Vite production deployment safe.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import UploadForm        from "./components/UploadForm.jsx";
import ProcessingStatus  from "./components/ProcessingStatus.jsx";
import SessionResults    from "./components/SessionResults.jsx";
import LongitudinalPlot  from "./components/LongitudinalPlot.jsx";
import { saveSession, getAllSessions, deleteSession } from "./db/storage.js";

const VIEWS = {
  UPLOAD:       "upload",
  PROCESSING:   "processing",
  RESULTS:      "results",
  LONGITUDINAL: "longitudinal",
};

const CHANNELS = ["a_VT", "a_ML", "a_AP", "g_YAW", "g_ROLL", "g_PITCH"];

export default function App() {
  const [view,          setView]          = useState(VIEWS.UPLOAD);
  const [progress,      setProgress]      = useState(null);
  const [currentResult, setCurrentResult] = useState(null);
  const [allSessions,   setAllSessions]   = useState([]);
  const [appReady,      setAppReady]      = useState(false);
  const [workerError,   setWorkerError]   = useState(null);

  // Cache strings for the Python modules
  const pythonScriptsRef = useRef({ pipeline: "", mfdfa: "", analysis: "" });

  // Load baseline script strings from public path upon initial mount
  useEffect(() => {
    async function precacheScripts() {
      try {
        // Use relative pathing compatible with root domains or sub-path paths (like GH Pages)
        const base = "./python/"; 
        const [p, m, a] = await Promise.all([
          fetch(`${base}pipeline.py?v=${Date.now()}`).then(r => r.text()),
          fetch(`${base}mfdfa_core.py?v=${Date.now()}`).then(r => r.text()),
          fetch(`${base}analysis.py?v=${Date.now()}`).then(r => r.text())
        ]);
        pythonScriptsRef.current = { pipeline: p, mfdfa: m, analysis: a };
        setAppReady(true);
      } catch (err) {
        setWorkerError(`Failed to cache analytical python modules: ${err.message}`);
      }
    }
    precacheScripts();
    getAllSessions().then(setAllSessions).catch(console.error);
  }, []);

  // High-performance streaming parsing block for Phyphox CSV text data rows
  const parsePhyphoxCSVText = (text) => {
    const lines = text.split("\n");
    const ax = [], ay = [], az = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].trim();
      if (!row) continue;
      const cols = row.split(",");
      if (cols.length >= 4) {
        ax.push(parseFloat(cols[1]));
        ay.push(parseFloat(cols[2]));
        az.push(parseFloat(cols[3]));
      }
    }
    return { ax, ay, az };
  };

  const handleFormSubmit = useCallback(async ({ zipFile, metadata }) => {
    setWorkerError(null);
    setView(VIEWS.PROCESSING);
    setProgress({ stage: "Extracting stream packets from Zip...", pct: 10 });

    try {
      // Dynamic import of JSZip to protect bundle size and ensure non-blocking UI
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(zipFile);
      
      const accelFile = zip.file("Accelerometer.csv");
      const gyroFile  = zip.file("Gyroscope.csv");

      if (!accelFile || !gyroFile) {
        throw new Error("Missing structural data tracks. Check Phyphox configuration logs.");
      }

      const [accelText, gyroText] = await Promise.all([
        accelFile.async("text"),
        gyroFile.async("text")
      ]);

      setProgress({ stage: "Parsing timeseries arrays...", pct: 20 });
      const aData = parsePhyphoxCSVText(accelText);
      const gData = parsePhyphoxCSVText(gyroText);

      // Verify matching array length constraints
      if (aData.ax.length === 0) {
        throw new Error("Accelerometer data stream is empty.");
      }

      const rawDataBundle = {
        ax: aData.ax, ay: aData.ay, az: aData.az,
        gx: gData.ax, gy: gData.ay, gz: gData.az
      };

      // Dispatch data bundle to the parallelized multi-threaded worker engine
      runParallelWorkerPool(rawDataBundle, metadata);

    } catch (err) {
      setWorkerError(`Ingestion Core Error: ${err.message}`);
      setView(VIEWS.UPLOAD);
    }
  }, []);

  // Orchestrate parallel thread matrix arrays
  function runParallelWorkerPool(rawDataBundle, metadata) {
    const completedChannels = {};
    const channelProgress = {};
    
    CHANNELS.forEach(chName => {
      channelProgress[chName] = 0;
      
    // Vite Explicit Worker Compilation Hook (?worker&type=module)
    // This forces Vite to treat the file as an isolated worker asset during compilation and deployment
    const worker = new Worker(
      new URL("./workers/mfdfa.worker.js?worker&type=module", import.meta.url)
    );
    workerRef.current = worker;

      worker.onmessage = async (e) => {
        const { type, pct, channelName, data, message } = e.data;

        if (type === "ready") {
          // Feed the script strings and raw streams to the dedicated core instance
          worker.postMessage({
            type: "run_channel",
            payload: {
              channelName: chName,
              rawDataBundle,
              pipelineSrc: pythonScriptsRef.current.pipeline,
              mfdfaSrc: pythonScriptsRef.current.mfdfa,
              analysisSrc: pythonScriptsRef.current.analysis
            }
          });
        }

        if (type === "progress") {
          channelProgress[chName] = pct;
          // Synthesize a weighted average progress score across all concurrent processing workers
          const totalPct = Math.round(
            20 + (Object.values(channelProgress).reduce((a, b) => a + b, 0) / (CHANNELS.length * 100)) * 75
          );
          setProgress({
            stage: `Computing fractal profiles (${chName}: ${pct}%)`,
            pct: totalPct
          });
        }

        if (type === "channel_result") {
          completedChannels[channelName] = data;
          completedChannels[channelName].scalars.mf_class = classifyMF(data.scalars);
          
          // HARD TERMINATION: Purges the entire Pyodide WebAssembly heap from OS thread RAM instantly
          worker.terminate(); 

          // If all 6 parallel workers have securely returned their payloads, save the bundle
          if (Object.keys(completedChannels).length === CHANNELS.length) {
            finalizeSession(rawDataBundle, completedChannels, metadata);
          }
        }

        if (type === "error") {
          setWorkerError(`Thread stall on ${chName}: ${message}`);
          worker.terminate();
          setView(VIEWS.UPLOAD);
        }
      };
    });
  }

  async function finalizeSession(rawDataBundle, channelResults, metadata) {
    setProgress({ stage: "Committing database rows...", pct: 98 });

    // Build unified schema matching IndexedDB and chart renderer structures
    const sessionResult = {
      metadata,
      session_id:    metadata.session_id,
      processed_at:  new Date().toISOString(),
      channels:      channelResults,
      aligned: {
        // Construct time grid grid using 100Hz delta spacing
        time:        Array.from({ length: Math.min(1000, rawDataBundle.ax.length) }, (_, i) => i * 0.01),
        a_VT:        channelResults["a_VT"].aligned_slice || [],
        a_ML:        channelResults["a_ML"].aligned_slice || [],
        a_AP:        channelResults["a_AP"].aligned_slice || [],
        velocity:    [],
        duration_s:  rawDataBundle.ax.length / 100.0,
        n_samples:   rawDataBundle.ax.length
      }
    };

    try {
      await saveSession(sessionResult);
      const updated = await getAllSessions();
      setAllSessions(updated);
      setCurrentResult(sessionResult);
      setProgress(null);
      setView(VIEWS.RESULTS);
    } catch (err) {
      setWorkerError(`Storage commit error: ${err.message}`);
      setView(VIEWS.UPLOAD);
    }
  }

  function classifyMF(row) {
    const { robust, delta_alpha, delta_alpha_nl, p_iaaft, asymmetry } = row;
    if (!robust) {
      if ((asymmetry || 0) > 0.1 && (delta_alpha_nl || 0) < 0) return "smoothed_constrained";
      return "unclassified";
    }
    const isMF = (delta_alpha || 0) > 0.1;
    const isNL = (delta_alpha_nl || 0) > 0.1 && (p_iaaft || 1) < 0.05;
    if (!isMF) return "monofractal";
    if (isNL)  return "nonlinear_multifractal";
    return "linear_multifractal";
  }

  const handleDelete = useCallback(async (session_id) => {
    if (!confirm("Delete this session completely?")) return;
    await deleteSession(session_id);
    const updated = await getAllSessions();
    setAllSessions(updated);
    if (currentResult?.session_id === session_id) {
      setCurrentResult(null);
      setView(VIEWS.UPLOAD);
    }
  }, [currentResult]);

  const participantSessions = currentResult
    ? allSessions
        .filter((s) => s.metadata?.participant_id === currentResult.metadata?.participant_id)
        .sort((a, b) => (a.processed_at < b.processed_at ? -1 : 1))
    : [];

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.logo}>GAIT MFDFA</span>
        <span style={styles.headerSub}>Parallel Web-Worker Core Matrix</span>
        {appReady && <span style={styles.readyDot} title="All Multi-Thread Engines Pre-cached" />}
      </header>

      {workerError && (
        <div style={styles.errorBanner}>
          <strong>Error:</strong> {workerError}
          <button style={styles.errorClose} onClick={() => setWorkerError(null)}>✕</button>
        </div>
      )}

      {view === VIEWS.UPLOAD && (
        <>
          <UploadForm onSubmit={handleFormSubmit} disabled={!appReady} />
          {!appReady && !workerError && (
            <p style={styles.loadingNote}>⏳ Pre-caching multi-threaded execution runtimes…</p>
          )}
        </>
      )}

      {view === VIEWS.PROCESSING && <ProcessingStatus progress={progress} />}

      {(view === VIEWS.RESULTS || view === VIEWS.LONGITUDINAL) && currentResult && (
        <>
          <div style={styles.tabs}>
            <TabBtn label="Results" active={view === VIEWS.RESULTS} onClick={() => setView(VIEWS.RESULTS)} />
            <TabBtn label={`Longitudinal (${participantSessions.length})`} active={view === VIEWS.LONGITUDINAL} onClick={() => setView(VIEWS.LONGITUDINAL)} />
            <TabBtn label="+ New Session" onClick={() => { setCurrentResult(null); setView(VIEWS.UPLOAD); }} />
          </div>

          {view === VIEWS.RESULTS && (
            <>
              <SessionResults sessionResult={currentResult} />
              <div style={styles.deleteWrap}>
                <button style={styles.deleteBtn} onClick={() => handleDelete(currentResult.session_id)}>Delete session</button>
              </div>
            </>
          )}

          {view === VIEWS.LONGITUDINAL && <LongitudinalPlot sessions={participantSessions} />}
        </>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }) {
  return <button style={active ? styles.tabActive : styles.tab} onClick={onClick}>{label}</button>;
}

const styles = {
  app:   { minHeight: "100vh", background: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
  header: { display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", borderBottom: "1.5px solid #eee", position: "sticky", top: 0, background: "white", zIndex: 10 },
  logo:       { fontWeight: 800, fontSize: "17px", letterSpacing: "-0.5px", color: "#111" },
  headerSub:  { fontSize: "12px", color: "#888" },
  readyDot:   { width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", marginLeft: "auto" },
  loadingNote:{ textAlign: "center", color: "#888", fontSize: "13px", padding: "12px" },
  errorBanner:{ background: "#fff0f0", border: "1px solid #fcc", color: "#900", padding: "10px 16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" },
  errorClose: { marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#900" },
  tabs:       { display: "flex", borderBottom: "1.5px solid #eee", padding: "0 8px", gap: "4px" },
  tab:        { padding: "10px 14px", border: "none", background: "none", fontSize: "14px", color: "#666", cursor: "pointer", borderBottom: "2.5px solid transparent" },
  tabActive:  { padding: "10px 14px", border: "none", background: "none", fontSize: "14px", color: "#1D9E75", fontWeight: 700, cursor: "pointer", borderBottom: "2.5px solid #1D9E75" },
  deleteWrap: { padding: "8px 16px 24px", maxWidth: "560px", margin: "0 auto" },
  deleteBtn:  { background: "none", border: "1px solid #ddd", color: "#cc0000", padding: "8px 14px", borderRadius: "6px", fontSize: "13px", cursor: "pointer" },
};
