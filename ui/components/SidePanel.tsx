/**
 * A panel that slides in from the right over the screen, with a title, a
 * close button and an optional footer. Escape or a click outside closes it.
 */
import { ReactNode, useEffect, useRef } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Heading } from "@dynatrace/strato-components/typography";
import { XmarkIcon } from "@dynatrace/strato-icons";
import { c } from "../theme";

export function SidePanel(props: { title: string; open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the panel unless a list inside it (a dropdown) is open.
      if (e.key === "Escape" && !document.querySelector("[role=listbox], [role=menu]")) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  if (!props.open) return null;
  return (
    <>
      <div aria-hidden="true" onClick={props.onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(22,25,31,0.28)" }} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 41,
          width: props.width ?? 460,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          background: c.surface,
          borderLeft: `1px solid ${c.line}`,
          boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${c.line}` }}>
          <Heading level={4}>{props.title}</Heading>
          <Button aria-label="Close" onClick={props.onClose}>
            <Button.Prefix>
              <XmarkIcon />
            </Button.Prefix>
          </Button>
        </div>
        <div style={{ flex: "1 1 auto", overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>{props.children}</div>
      </div>
    </>
  );
}

/** A numbered step inside a panel. */
export function Step(props: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", width: 20, height: 20, borderRadius: 999, background: c.accentStrong, color: "#FFFFFF", alignItems: "center", justifyContent: "center", fontSize: 12 }}
        >
          {props.n}
        </span>
        {props.title}
      </div>
      {props.children}
    </section>
  );
}
