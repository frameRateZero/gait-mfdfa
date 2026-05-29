/**
 * components/LongitudinalPlot.jsx
 * ================================
 * Longitudinal metric plots across sessions for a participant.
 * Default metrics: delta_alpha, alpha_0, delta_alpha_nl, asymmetry
 * Default channels: a_ML, g_ROLL (most stable longitudinally)
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useState } from "react";

const CHANNEL_COLORS = {
  a_VT:    "#2B83BA",
  a_ML:    "#7B2D8B",
  a_AP:    "#1D9E75",
  g_ROLL:  "#D7191C",
  g_PITCH: "#E66101",
  g_YAW:   "#BA7517",
};

const METRIC_LABELS = {
  delta_alpha:    "Δα (spectral width)",
  alpha_0:        "α₀ (dominant singularity)",
  delta_alpha_nl: "Δα_nl (nonlinear component)",
  asymmetry:      "Asymmetry",
  f_max:          "f_max",
  H_q_range:      "H(q) range",
  p_iaaft:        "p_iaaft",
};

const ALL_CHANNELS  = ["a_VT", "a_ML", "a_AP", "g_YAW", "g_ROLL", "g_PITCH"];
const ALL_METRICS   = Object.keys(METRIC_LABELS);

// Reference bands for clinical interpretation
const REFERENCE_BANDS = {
  alpha_0: [
    { y: 0.35, label: "continuous walk min", color: "#ccc" },
    { y: 0.55, label: "continuous walk max", color: "#ccc" },
    { y: 0.6,  label: "community walk min",  color: "#eee" },
    { y: 0.9,  label: "community walk max",  color: "#eee" },
  ],
};

function formatDate(session_id) {
  // "2026-05-16_22-14-57" → "05/16"
  const m = session_id?.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}`;
  return session_id?.slice(0, 10) || "?";
}

export default function LongitudinalPlot({ sessions }) {
  const [selectedChannels, setSelectedChannels] = useState(["a_ML", "g_ROLL"]);
  const [selectedMetric,   setSelectedMetric]   = useState("delta_alpha");

  if (!sessions || sessions.length < 2) {
    return (
      <div style={styles.empty}>
        <p>Longitudinal plots appear after 2 or more sessions.</p>
      </div>
    );
  }

  // Build chart data: one point per session per channel
  const chartData = sessions.map((sess) => {
    const point = {
      label:      formatDate(sess.metadata?.session_id || sess.session_id),
      session_id: sess.session_id,
      walk_env:   sess.metadata?.walk_env,
    };
    for (const ch of selectedChannels) {
      const val = sess.channels?.[ch]?.scalars?.[selectedMetric];
      point[ch] = val != null ? Number(val) : null;
    }
    return point;
  });

  const refLines = REFERENCE_BANDS[selectedMetric] || [];

  function toggleChannel(ch) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Longitudinal Tracking</h2>
      <p style={styles.subtitle}>{sessions.length} sessions • {sessions[0]?.metadata?.participant_id}</p>

      {/* Metric selector */}
      <label style={styles.selectLabel}>Metric</label>
      <select
        style={styles.select}
        value={selectedMetric}
        onChange={(e) => setSelectedMetric(e.target.value)}
      >
        {ALL_METRICS.map((m) => (
          <option key={m} value={m}>{METRIC_LABELS[m]}</option>
        ))}
      </select>

      {/* Channel toggles */}
      <label style={styles.selectLabel}>Channels</label>
      <div style={styles.toggleRow}>
        {ALL_CHANNELS.map((ch) => (
          <button
            key={ch}
            type="button"
            style={{
              ...styles.toggle,
              background: selectedChannels.includes(ch) ? CHANNEL_COLORS[ch] : "white",
              color: selectedChannels.includes(ch) ? "white" : "#444",
              borderColor: CHANNEL_COLORS[ch],
            }}
            onClick={() => toggleChannel(ch)}
          >
            {ch}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            width={42}
          />
          <Tooltip
            labelFormatter={(l, payload) => {
              const env = payload?.[0]?.payload?.walk_env;
              return `${l}${env ? ` (${env})` : ""}`;
            }}
            formatter={(v, name) => [v?.toFixed(4), name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Reference lines for clinical context */}
          {refLines.map((r, i) => (
            <ReferenceLine key={i} y={r.y} stroke={r.color} strokeDasharray="4 2" />
          ))}

          {selectedChannels.map((ch) => (
            <Line
              key={ch}
              type="monotone"
              dataKey={ch}
              stroke={CHANNEL_COLORS[ch]}
              strokeWidth={2}
              dot={{ r: 4, fill: CHANNEL_COLORS[ch] }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Session table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Session</th>
              <th style={styles.th}>Env</th>
              {selectedChannels.map((ch) => (
                <th key={ch} style={{ ...styles.th, color: CHANNEL_COLORS[ch] }}>{ch}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartData.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9f9f9" }}>
                <td style={styles.td}>{row.label}</td>
                <td style={styles.td}>{row.walk_env || "—"}</td>
                {selectedChannels.map((ch) => (
                  <td key={ch} style={styles.tdNum}>
                    {row[ch] != null ? row[ch].toFixed(3) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: "0 16px 32px",
    maxWidth: "640px",
    margin: "0 auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  h2:       { fontSize: "20px", fontWeight: 600, margin: "16px 0 4px" },
  subtitle: { fontSize: "12px", color: "#888", margin: "0 0 12px" },
  selectLabel: { fontSize: "12px", fontWeight: 600, color: "#555", display: "block", margin: "8px 0 4px" },
  select: {
    width: "100%",
    padding: "8px 10px",
    border: "1.5px solid #ddd",
    borderRadius: "6px",
    fontSize: "14px",
    background: "white",
  },
  toggleRow: { display: "flex", flexWrap: "wrap", gap: "6px", margin: "4px 0 12px" },
  toggle: {
    padding: "5px 10px",
    border: "1.5px solid",
    borderRadius: "16px",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: 600,
    transition: "all 0.15s",
  },
  tableWrap: { overflowX: "auto", marginTop: "16px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "12px" },
  th: { padding: "6px 8px", borderBottom: "2px solid #eee", fontWeight: 600, textAlign: "left" },
  td: { padding: "5px 8px", borderBottom: "1px solid #f0f0f0", color: "#444" },
  tdNum: { padding: "5px 8px", borderBottom: "1px solid #f0f0f0", color: "#222", fontVariantNumeric: "tabular-nums", textAlign: "right" },
  empty: { padding: "24px 16px", color: "#888", fontSize: "14px", textAlign: "center" },
};
