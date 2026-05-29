/**
 * src/App.jsx
 * ===========
 * Root React component for GAIT MFDFA PWA.
 *
 * State machine:  idle → processing → results ↔ longitudinal
 *
 * Worker is created once and reused.  Pyodide boots on first postMessage.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import UploadForm        from "./components/UploadForm.jsx";
import ProcessingStatus  from "./components/ProcessingStatus.jsx";
import SessionResults    from "./components/SessionResults.jsx";
import LongitudinalPlot  from "./components/LongitudinalPlot.jsx";
import {
  saveSession,
  getAllSessions,
  deleteSession,
} from "./db/storage.js";

const VIEWS = {
  UPLOAD:       "upload",
  PROCESSING:   "processing",
  RESULTS:      "results",
  LONGITUDINAL: "longitudinal",
};

export default function App() {
  const [view,          setView]          = useState(VIEWS.UPLOAD);
  const [progress,      setProgress]      = useState(null);
  const [currentResult, setCurrentResult] = useState(null);
  const [allSessions,   setAllSessions]   = useState([]);
  const [workerReady,   setWorkerReady]   = useState(false);
  const [workerError,   setWorkerError]   = useState(null);

  const workerRef = useRef(null);

  // ── Init worker once ─────────────────────────────────────────────────────
  useEffect(() => {
    // Vite bundled worker — import.meta.url worker syntax
    const worker = new Worker(
      new URL("./workers/mfdfa.worker.js", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      const { type, ...payload } = msg;

      switch (type) {
        case "ready":
          setWorkerReady(true);
          break;
        case "progress":
          setProgress({ ...payload });
          break;
        case "result":
          handleResult(payload.sessionResult);
          break;
        case "error":
          setWorkerError(payload.message);
          setView(VIEWS.UPLOAD);
          break;
        default:
          break;
      }
    };

    worker.onerror = (err) => {
      setWorkerError(`Worker error: ${err.message}`);
      setView(VIEWS.UPLOAD);
    };

    getAllSessions().then(setAllSessions).catch(console.error);

    return () => worker.terminate();
  }, []); // eslint-disable-line

  const handleResult = useCallback(async (sessionResult) => {
    try {
      await saveSession(sessionResult);
      const updated = await getAllSessions();
      setAllSessions(updated);
    } catch (err) {
      console.error("Failed to save session:", err);
    }
    setCurrentResult(sessionResult);
    setProgress(null);
    setView(VIEWS.RESULTS);
  }, []);

  const handleFormSubmit = useCallback(async ({ zipFile, metadata }) => {
    setWorkerError(null);
    setProgress({ stage: "loading_python", pct: 0 });
    setView(VIEWS.PROCESSING);
    const zipBytes = await zipFile.arrayBuffer();
    workerRef.current.postMessage(
      { type: "run", payload: { zipBytes, metadata } },
      [zipBytes]
    );
  }, []);

  const handleDelete = useCallback(async (session_id) => {
    if (!confirm("Delete this session?")) return;
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
        <span style={styles.headerSub}>Phyphox IMU analysis</span>
        {workerReady && <span style={styles.readyDot} title="Pyodide ready" />}
      </header>

      {workerError && (
        <div style={styles.errorBanner}>
          <strong>Error:</strong> {workerError}
          <button style={styles.errorClose} onClick={() => setWorkerError(null)}>✕</button>
        </div>
      )}

      {view === VIEWS.UPLOAD && (
        <>
          <UploadForm
            onSubmit={handleFormSubmit}
            disabled={!workerReady && !workerError}
          />
          {!workerReady && !workerError && (
            <p style={styles.loadingNote}>⏳ Loading Pyodide + MFDFA (first visit only)…</p>
          )}
        </>
      )}

      {view === VIEWS.PROCESSING && (
        <ProcessingStatus progress={progress} />
      )}

      {(view === VIEWS.RESULTS || view === VIEWS.LONGITUDINAL) && currentResult && (
        <>
          <div style={styles.tabs}>
            <TabBtn label="Results"
              active={view === VIEWS.RESULTS}
              onClick={() => setView(VIEWS.RESULTS)} />
            <TabBtn
              label={`Longitudinal (${participantSessions.length})`}
              active={view === VIEWS.LONGITUDINAL}
              onClick={() => setView(VIEWS.LONGITUDINAL)} />
            <TabBtn label="+ New Session"
              onClick={() => { setCurrentResult(null); setView(VIEWS.UPLOAD); }} />
          </div>

          {view === VIEWS.RESULTS && (
            <>
              <SessionResults sessionResult={currentResult} />
              <div style={styles.deleteWrap}>
                <button style={styles.deleteBtn}
                  onClick={() => handleDelete(currentResult.session_id)}>
                  Delete session
                </button>
              </div>
            </>
          )}

          {view === VIEWS.LONGITUDINAL && (
            <LongitudinalPlot sessions={participantSessions} />
          )}
        </>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }) {
  return (
    <button style={active ? styles.tabActive : styles.tab} onClick={onClick}>
      {label}
    </button>
  );
}

const styles = {
  app:   { minHeight: "100vh", background: "#fff",
           fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  header: { display: "flex", alignItems: "center", gap: "10px",
            padding: "14px 16px", borderBottom: "1.5px solid #eee",
            position: "sticky", top: 0, background: "white", zIndex: 10 },
  logo:       { fontWeight: 800, fontSize: "17px", letterSpacing: "-0.5px", color: "#111" },
  headerSub:  { fontSize: "12px", color: "#888" },
  readyDot:   { width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", marginLeft: "auto" },
  loadingNote:{ textAlign: "center", color: "#888", fontSize: "13px", padding: "12px" },
  errorBanner:{ background: "#fff0f0", border: "1px solid #fcc", color: "#900",
                padding: "10px 16px", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" },
  errorClose: { marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#900" },
  tabs:       { display: "flex", borderBottom: "1.5px solid #eee", padding: "0 8px", gap: "4px" },
  tab:        { padding: "10px 14px", border: "none", background: "none", fontSize: "14px",
                color: "#666", cursor: "pointer", borderBottom: "2.5px solid transparent" },
  tabActive:  { padding: "10px 14px", border: "none", background: "none", fontSize: "14px",
                color: "#0077cc", fontWeight: 700, cursor: "pointer", borderBottom: "2.5px solid #0077cc" },
  deleteWrap: { padding: "8px 16px 24px", maxWidth: "560px", margin: "0 auto" },
  deleteBtn:  { background: "none", border: "1px solid #ddd", color: "#cc0000",
                padding: "8px 14px", borderRadius: "6px", fontSize: "13px", cursor: "pointer" },
};
