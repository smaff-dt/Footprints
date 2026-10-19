/**
 * Plain form controls styled for business users: labelled dropdowns,
 * segmented toggles and checkboxes. No technical vocabulary.
 */
import React, { useId } from "react";
import { c } from "../theme";

const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: c.muted };

const selectStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: `1px solid ${c.lineStrong}`,
  background: c.surface,
  color: c.ink,
  minWidth: 180,
  maxWidth: "100%",
};

export interface Option<V extends string> {
  value: V;
  label: string;
}

export function Dropdown<V extends string>(props: {
  label: string;
  value: V | "";
  options: Option<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  placeholder?: string;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: props.wide ? "1 1 320px" : undefined }}>
      <label htmlFor={id} style={fieldLabel}>
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value as V)}
        style={{ ...selectStyle, width: props.wide ? "100%" : undefined, opacity: props.disabled ? 0.6 : 1 }}
      >
        {props.placeholder !== undefined && (
          <option value="" disabled>
            {props.placeholder}
          </option>
        )}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<V extends string>(props: {
  label: string;
  value: V;
  options: Option<V>[];
  onChange: (value: V) => void;
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span id={id} style={fieldLabel}>
        {props.label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        style={{ display: "flex", flexWrap: "wrap", padding: 3, gap: 3, borderRadius: 12, background: c.surfaceAlt }}
      >
        {props.options.map((o) => {
          const on = o.value === props.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => props.onChange(o.value)}
              style={{
                minHeight: 38,
                padding: "0 14px",
                borderRadius: 9,
                border: 0,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                background: on ? c.surface : "transparent",
                color: on ? c.ink : c.muted,
                boxShadow: on ? "0 1px 3px rgba(22,25,31,0.14)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ width: 18, height: 18, margin: 0, accentColor: "#2F4BD8" }}
      />
      <label htmlFor={id} style={{ fontSize: 14 }}>
        {props.label}
      </label>
    </div>
  );
}

export function Card(props: { children: React.ReactNode; style?: React.CSSProperties; label?: string }) {
  return (
    <section
      aria-label={props.label}
      style={{
        background: c.surface,
        border: `1px solid ${c.line}`,
        borderRadius: 14,
        padding: 18,
        ...props.style,
      }}
    >
      {props.children}
    </section>
  );
}
