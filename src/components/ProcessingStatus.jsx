/**
 * components/ProcessingStatus.jsx
 * ================================
 * Progress display during MFDFA pipeline.
 */

const CHANNEL_LABELS = {
  a_VT:    "a_VT (vertical)",
  a_ML:    "a_ML (mediolateral) ★",
  a_AP:    "a_AP (anteroposterior) ★",
  g_YAW:   "g_YAW (yaw)",
  g_ROLL:  "g_ROLL (roll) ★",
  g_PITCH: "g_PITCH (pitch) ★",
};

const STAGE_LABELS = {
  loading_python: "Loading Python environment…",
  parsing_zip:    "Parsing Phyphox zip…",
  tilt_corrected: "Tilt correction done",
  mfdfa:          "Running MFDFA",
  surrogates:     "Running IAAFT surrogates",
  channel_done:   "Channel complete",
};

export default function ProcessingStatus({ progress }) {
  if (!progress) return null;

  const { stage, channel, pct, surrogate, n_surrogates } = progress;

  const label =
    stage === "surrogates" && channel
      ? `${CHANNEL_LABELS[channel] || channel} — surrogate ${surrogate}/${n_surrogates}`
      : stage === "mfdfa" && channel
      ? `${CHANNEL_LABELS[channel] || channel} — starting MFDFA`
      : stage === "channel_done" && channel
      ? `${CHANNEL_LABELS[channel] || channel} ✓`
      : STAGE_LABELS[stage] || stage;

  return (
    <div style={styles.container}>
      <p style={styles.label}>{label}</p>
      <div style={styles.barBg}>
        <div style={{ ...styles.bar, width: `${pct ?? 0}%` }} />
      </div>
      <p style={styles.pct}>{pct ?? 0}%</p>
      <p style={styles.note}>
        ★ Primary outcome channels — ~3 minutes total
      </p>
    </div>
  );
}

const styles = {
  container: {
    padding: "24px 16px",
    maxWidth: "480px",
    margin: "0 auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  label: {
    fontSize: "14px",
    color: "#333",
    marginBottom: "8px",
    minHeight: "20px",
  },
  barBg: {
    background: "#e0e0e0",
    borderRadius: "6px",
    height: "10px",
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    background: "linear-gradient(90deg, #0077cc, #00aaff)",
    borderRadius: "6px",
    transition: "width 0.3s ease",
  },
  pct: {
    fontSize: "13px",
    color: "#666",
    marginTop: "4px",
    textAlign: "right",
  },
  note: {
    fontSize: "11px",
    color: "#999",
    marginTop: "12px",
  },
};
