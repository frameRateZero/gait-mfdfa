/**
 * components/UploadForm.jsx
 * ========================
 * Zip upload + metadata form.
 * Session ID is auto-extracted from the zip filename.
 * Designed for iPhone use — large touch targets, under 90 seconds.
 */

import { useState, useRef } from "react";

const WALKING_ENVS = ["Community", "Treadmill", "Corridor", "Home"];
const WALKING_AIDS = ["None", "Cane", "Walker", "AFO", "Prosthesis"];
const LOAD_OPTIONS = ["None", "Right bag", "Left bag", "Both bags", "Backpack"];

function extractSessionId(filename) {
  // "GaitGyro_2026-05-16_22-14-57.zip" → "2026-05-16_22-14-57"
  const m = filename.match(/(\d{4}-\d{2}-\d{2}[_ ]\d{2}[-:]\d{2}[-:]\d{2})/);
  if (m) return m[1].replace(/ /g, "_");
  return filename.replace(/\.zip$/i, "");
}

export default function UploadForm({ onSubmit, disabled }) {
  const fileRef = useRef(null);
  const [zipFile, setZipFile]         = useState(null);
  const [sessionId, setSessionId]     = useState("");
  const [participantId, setParticipantId] = useState("");
  const [walkEnv, setWalkEnv]         = useState("Community");
  const [walkAid, setWalkAid]         = useState("None");
  const [load, setLoad]               = useState("None");
  const [loadLbs, setLoadLbs]         = useState(0);
  const [pain, setPain]               = useState(0);
  const [fatigue, setFatigue]         = useState(0);
  const [notes, setNotes]             = useState("");
  const [error, setError]             = useState(null);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setError("Please select a Phyphox .zip file.");
      return;
    }
    setError(null);
    setZipFile(f);
    setSessionId(extractSessionId(f.name));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!zipFile)         return setError("Please select a zip file.");
    if (!participantId.trim()) return setError("Participant ID is required.");

    const metadata = {
      participant_id: participantId.trim(),
      session_id:     sessionId,
      walk_env:       walkEnv,
      walk_aid:       walkAid,
      load,
      load_lbs:       load !== "None" ? loadLbs : 0,
      pain,
      fatigue,
      notes: notes.trim(),
    };

    onSubmit({ zipFile, metadata });
  }

  return (
    <form
      style={styles.form}
      onSubmit={handleSubmit}
    >
      <h2 style={styles.h2}>New Session</h2>

      {/* ── Zip upload ── */}
      <label style={styles.label}>Phyphox zip</label>
      <div
        style={styles.dropZone}
        onClick={() => fileRef.current?.click()}
      >
        {zipFile
          ? <span style={styles.fileName}>{zipFile.name}</span>
          : <span style={styles.placeholder}>Tap to select .zip</span>
        }
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={handleFile}
        />
      </div>

      {sessionId && (
        <p style={styles.sessionId}>Session: {sessionId}</p>
      )}

      {/* ── Participant ID ── */}
      <label style={styles.label}>Participant ID</label>
      <input
        style={styles.input}
        type="text"
        placeholder="e.g. P001"
        value={participantId}
        onChange={(e) => setParticipantId(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
      />

      {/* ── Walking environment ── */}
      <label style={styles.label}>Walking environment</label>
      <div style={styles.pills}>
        {WALKING_ENVS.map((opt) => (
          <button
            key={opt}
            type="button"
            style={walkEnv === opt ? styles.pillActive : styles.pill}
            onClick={() => setWalkEnv(opt)}
          >{opt}</button>
        ))}
      </div>

      {/* ── Walking aid ── */}
      <label style={styles.label}>Walking aid</label>
      <div style={styles.pills}>
        {WALKING_AIDS.map((opt) => (
          <button
            key={opt}
            type="button"
            style={walkAid === opt ? styles.pillActive : styles.pill}
            onClick={() => setWalkAid(opt)}
          >{opt}</button>
        ))}
      </div>

      {/* ── Load ── */}
      <label style={styles.label}>Load</label>
      <div style={styles.pills}>
        {LOAD_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            style={load === opt ? styles.pillActive : styles.pill}
            onClick={() => setLoad(opt)}
          >{opt}</button>
        ))}
      </div>

      {load !== "None" && (
        <>
          <label style={styles.label}>Load weight: {loadLbs} lbs</label>
          <input
            style={styles.slider}
            type="range"
            min={0} max={45} step={1}
            value={loadLbs}
            onChange={(e) => setLoadLbs(Number(e.target.value))}
          />
        </>
      )}

      {/* ── Pain ── */}
      <label style={styles.label}>Pain: {pain} / 10</label>
      <input
        style={styles.slider}
        type="range"
        min={0} max={10} step={1}
        value={pain}
        onChange={(e) => setPain(Number(e.target.value))}
      />

      {/* ── Fatigue ── */}
      <label style={styles.label}>Fatigue: {fatigue} / 10</label>
      <input
        style={styles.slider}
        type="range"
        min={0} max={10} step={1}
        value={fatigue}
        onChange={(e) => setFatigue(Number(e.target.value))}
      />

      {/* ── Notes ── */}
      <label style={styles.label}>Notes (optional)</label>
      <textarea
        style={styles.textarea}
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Any additional observations…"
      />

      {error && <p style={styles.error}>{error}</p>}

      <button
        type="submit"
        style={disabled ? styles.btnDisabled : styles.btn}
        disabled={disabled}
      >
        {disabled ? "Processing…" : "Run Analysis"}
      </button>
    </form>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────

const styles = {
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "16px",
    maxWidth: "480px",
    margin: "0 auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  h2: { margin: "0 0 8px", fontSize: "20px", fontWeight: 600 },
  label: { fontSize: "13px", fontWeight: 600, color: "#555", marginTop: "4px" },
  input: {
    padding: "10px 12px",
    border: "1.5px solid #ddd",
    borderRadius: "8px",
    fontSize: "16px",   // prevents iOS zoom
    outline: "none",
  },
  dropZone: {
    border: "2px dashed #bbb",
    borderRadius: "10px",
    padding: "20px",
    textAlign: "center",
    cursor: "pointer",
    background: "#fafafa",
  },
  fileName: { fontSize: "14px", color: "#333", wordBreak: "break-all" },
  placeholder: { fontSize: "14px", color: "#999" },
  sessionId: { fontSize: "12px", color: "#0077cc", margin: "2px 0 0" },
  pills: { display: "flex", flexWrap: "wrap", gap: "6px" },
  pill: {
    padding: "7px 12px",
    border: "1.5px solid #ccc",
    borderRadius: "20px",
    background: "white",
    fontSize: "14px",
    cursor: "pointer",
    color: "#444",
  },
  pillActive: {
    padding: "7px 12px",
    border: "1.5px solid #0077cc",
    borderRadius: "20px",
    background: "#e8f4ff",
    fontSize: "14px",
    cursor: "pointer",
    color: "#0055aa",
    fontWeight: 600,
  },
  slider: { width: "100%", accentColor: "#0077cc" },
  textarea: {
    padding: "10px 12px",
    border: "1.5px solid #ddd",
    borderRadius: "8px",
    fontSize: "15px",
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
  },
  btn: {
    marginTop: "12px",
    padding: "14px",
    background: "#0077cc",
    color: "white",
    border: "none",
    borderRadius: "10px",
    fontSize: "16px",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDisabled: {
    marginTop: "12px",
    padding: "14px",
    background: "#aaa",
    color: "white",
    border: "none",
    borderRadius: "10px",
    fontSize: "16px",
    fontWeight: 700,
    cursor: "not-allowed",
  },
  error: { color: "#cc0000", fontSize: "13px", margin: "4px 0 0" },
};
