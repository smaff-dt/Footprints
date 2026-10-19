import { c } from "../theme";

export function Loading(props: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={props.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: props.rows ?? 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 54,
            borderRadius: 10,
            background: c.surfaceAlt,
            animation: "fp-pulse 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
      <span style={{ fontSize: 13, color: c.muted }}>{props.label}</span>
    </div>
  );
}

export function ErrorNotice(props: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ padding: "14px 16px", borderRadius: 12, background: c.warnSoft, color: c.warnInk }}>
      <div style={{ fontWeight: 700 }}>{props.title}</div>
      <div style={{ fontSize: 14, marginTop: 4, wordBreak: "break-word" }}>{props.detail}</div>
      {props.onRetry && (
        <button
          type="button"
          onClick={props.onRetry}
          style={{
            marginTop: 10,
            minHeight: 40,
            padding: "0 14px",
            borderRadius: 10,
            border: `1px solid ${c.lineStrong}`,
            background: c.surface,
            color: c.ink,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty(props: { title: string; detail: string }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center", color: c.muted }}>
      <div style={{ fontWeight: 700, color: c.ink, fontSize: 16 }}>{props.title}</div>
      <div style={{ fontSize: 14, marginTop: 6, maxWidth: 460, marginInline: "auto" }}>{props.detail}</div>
    </div>
  );
}
