/**
 * Loading, error and empty states, in Strato's look.
 */
import { Button } from "@dynatrace/strato-components/buttons";
import { Skeleton } from "@dynatrace/strato-components/content";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Borders, Colors } from "@dynatrace/strato-design-tokens";
import { c } from "../theme";

export function Loading(props: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={props.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: props.rows ?? 4 }).map((_, i) => (
        <Skeleton key={i} height={48} width="100%" />
      ))}
      <Text style={{ color: c.muted }}>{props.label}</Text>
    </div>
  );
}

export function ErrorNotice(props: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        padding: "12px 16px",
        borderRadius: Borders.Radius.Container.Default,
        background: Colors.Background.Container.Critical.Default,
        border: `1px solid ${Colors.Border.Critical.Default}`,
        color: c.ink,
      }}
    >
      <Text style={{ fontWeight: 600, color: Colors.Text.Critical.Default, display: "block" }}>{props.title}</Text>
      <Text style={{ display: "block", marginTop: 4 }}>
        Please try again in a moment. If it keeps happening, share the technical details below with your Dynatrace administrator.
      </Text>
      <details style={{ marginTop: 8, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Technical details</summary>
        <div style={{ marginTop: 6, wordBreak: "break-word", fontFamily: "ui-monospace, Menlo, monospace" }}>{props.detail}</div>
      </details>
      {props.onRetry && (
        <div style={{ marginTop: 10 }}>
          <Button onClick={props.onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

export function Empty(props: { title: string; detail: string }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center" }}>
      <Heading level={5}>{props.title}</Heading>
      <Text style={{ display: "block", color: c.muted, marginTop: 6, maxWidth: 460, marginInline: "auto" }}>{props.detail}</Text>
    </div>
  );
}
