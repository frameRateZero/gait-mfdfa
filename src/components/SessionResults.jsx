/**
 * components/SessionResults.jsx
 * ==============================
 * Display current session MFDFA results.
 * Shows per-channel scalar table + small f(α) sparklines via recharts.
 */

import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

const CHANNEL_COLORS = {
  a_VT:    "#2B83BA",
  a_ML:    "#7B2D8B",
  a_AP:    "#1D9E75",
  g_ROLL:  "#D7191C",
  g_PITCH: "#E66101",
  g_YAW:   "#BA7517",
};

const MF_CLASS_COLORS = {
  nonlinear_multifractal:  "#1D9E75",
  linear_multifractal:     "#E66101",
  monofractal:             "#888888",
  smoothed_constrained:    "#7B2D8B",
  unclassified:            "#aaaaaa",
};

const PRIMARY = new Set(["a_ML", "a_AP", "g_ROLL", "g_PITCH"]);

function fmt(v, dp = 3) {
  if (v == null || v !== v) return "—";
  return Number(v).toFixed(dp);
}

function fmtSigned(v, dp = 3) {
  if (v == null || v !== v) return "—";
  const n = Number(v);
  return (n >= 0 ? "+" : "") + n.toFixed(dp);
}

function SpectrumSparkline({ channel, result }) {
  if (!result) return null;
  const { alpha, f_alpha, surr_alpha, surr_f_alpha, alpha_0 } = result;
  const color = CHANNEL_COLORS[channel] || "#555";

  // Build recharts data — zip alpha + f_alpha, filter finite
  const origData = (alpha || []).map((a, i) => ({
    a: a,
    f: f_alpha?.[i],
  })).filter((d) => d.a != null && d.f != null && d.f >= 0 && isFinite(d.a) && isFinite(d.f));

  const surrData = (surr_alpha || []).map((a, i) => ({
    a,
    fs: surr_f_alpha?.[i],
  })).filter((d) => d.a != null && d.fs != null && d.fs >= 0 && isFinite(d.a) && isFinite(d.fs));

  // Merge by sorting on α
  origData.sort((a, b) => a.a - b.a);
  surrData.sort((a, b) => a.a - b.a);

  // Use orig x-domain
  const allA = origData.map((d) => d.a);
  const xMin = allA.length ? Math.min(...allA) - 0.05 : 0;
  const xMax = allA.length ? Math.max(...allA) + 0.05 : 1;

  return (
    <div style={styles.sparklineWrap}>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          {surrData.length > 0 && (
            <Line
              data={surrData}
              dataKey="fs"
              dot={false}
              stroke="#cccccc"
              strokeWidth={1}
              strokeDasharray="3 2"
              type="monotone"
              isAnimationActive={false}
            />
          )}
          <Line
            data={origData}
            dataKey="f"
            dot={false}
            stroke={color}
            strokeWidth={2}
            type="monotone"
            isAnimationActive={false}
          />
          {alpha_0 != null && (
            <ReferenceLine x={alpha_0} stroke={color} strokeDasharray="3 2" strokeWidth={1} />
          )}
          <ReferenceLine y={1.0} stroke="#ccc" strokeWidth={0.8} />
          <XAxis
            dataKey="a"
            type="number"
            domain={[xMin, xMax]}
            tickCount={3}
            tickFormatter={(v) => v.toFixed(2)}
            style={{ fontSize: 9 }}
            hide
          />
          <YAxis domain={[-0.05, 1.15]} hide />
          <Tooltip
            formatter={(v) => v?.toFixed(3)}
            labelFormatter={(v) => `α=${Number(v).toFixed(3)}`}
            contentStyle={{ fontSize: 10 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p style={styles.sparkLabel}>f(α)</p>
    </div>
  );
}

function ChannelRow({ channel, result }) {
  if (!result) return null;
  const { scalars } = result;
  const color     = CHANNEL_COLORS[channel] || "#555";
  const mfClass   = scalars?.mf_class || "unclassified";
  const classColor = MF_CLASS_COLORS[mfClass] || "#aaa";
  const isPrimary  = PRIMARY.has(channel);

  return (
    <div style={{ ...styles.channelRow, borderLeft: `4px solid ${color}` }}>
      <div style={styles.channelHeader}>
        <span style={{ ...styles.channelName, color }}>
          {channel}
          {isPrimary && <span style={styles.star}> ★</span>}
        </span>
        <span style={{ ...styles.mfClass, color: classColor }}>{mfClass}</span>
      </div>

      <div style={styles.metrics}>
        <Metric label="Δα"      value={fmt(scalars?.delta_alpha)} />
        <Metric label="Δα_nl"   value={fmt(scalars?.delta_alpha_nl)} />
        <Metric label="α₀"      value={fmt(scalars?.alpha_0)} />
        <Metric label="asym"    value={fmtSigned(scalars?.asymmetry)} />
        <Metric label="f_max"   value={fmt(scalars?.f_max, 2)} />
        <Metric label="H_range" value={fmt(scalars?.H_q_range)} />
        <Metric label="p_iaaft" value={fmt(scalars?.p_iaaft, 3)} />
      </div>

      <SpectrumSparkline channel={channel} result={result} />
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <span style={styles.metricVal}>{value}</span>
    </div>
  );
}

export default function SessionResults({ sessionResult }) {
  if (!sessionResult) return null;

  const { metadata, channels, aligned } = sessionResult;
  const CHANNEL_ORDER = ["a_VT", "a_ML", "a_AP", "g_YAW", "g_ROLL", "g_PITCH"];
  const duration = aligned?.duration_s
    ? `${(aligned.duration_s / 60).toFixed(1)} min`
    : "";

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Session Results</h2>

      {/* Metadata summary */}
      <div style={styles.metaBox}>
        <MetaRow label="Participant" value={metadata?.participant_id} />
        <MetaRow label="Session"    value={metadata?.session_id} />
        <MetaRow label="Environment" value={metadata?.walk_env} />
        <MetaRow label="Aid"        value={metadata?.walk_aid} />
        {metadata?.load !== "None" && (
          <MetaRow label="Load" value={`${metadata?.load} ${metadata?.load_lbs}lbs`} />
        )}
        <MetaRow label="Pain"       value={`${metadata?.pain}/10`} />
        <MetaRow label="Fatigue"    value={`${metadata?.fatigue}/10`} />
        {duration && <MetaRow label="Duration" value={duration} />}
      </div>

      <p style={styles.note}>★ Primary outcome channels</p>

      {/* Per-channel results */}
      {CHANNEL_ORDER.map((ch) => (
        <ChannelRow key={ch} channel={ch} result={channels?.[ch]} />
      ))}
    </div>
  );
}

function MetaRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={styles.metaRow}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={styles.metaVal}>{value}</span>
    </div>
  );
}

const styles = {
  container: {
    padding: "0 16px 32px",
    maxWidth: "560px",
    margin: "0 auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  h2: { fontSize: "20px", fontWeight: 600, margin: "16px 0 8px" },
  metaBox: {
    background: "#f5f5f5",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "12px",
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "4px 12px",
  },
  metaRow: { display: "contents" },
  metaLabel: { fontSize: "12px", color: "#777", textAlign: "right" },
  metaVal:   { fontSize: "12px", color: "#222", fontWeight: 500 },
  note: { fontSize: "11px", color: "#999", margin: "0 0 8px" },
  channelRow: {
    marginBottom: "12px",
    paddingLeft: "10px",
    paddingTop: "8px",
    paddingBottom: "4px",
    background: "#fafafa",
    borderRadius: "6px",
  },
  channelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px",
  },
  channelName: { fontSize: "15px", fontWeight: 700 },
  star: { color: "#f0a" },
  mfClass: { fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" },
  metrics: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginBottom: "6px",
  },
  metric: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: "52px",
  },
  metricLabel: { fontSize: "10px", color: "#888" },
  metricVal:   { fontSize: "13px", fontWeight: 600, color: "#222" },
  sparklineWrap: { position: "relative" },
  sparkLabel: { position: "absolute", top: 4, right: 6, fontSize: 9, color: "#aaa", margin: 0 },
};
