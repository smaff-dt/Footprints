/**
 * Form controls from Strato, the Dynatrace design system, wrapped with the
 * few options Footprints needs: labelled dropdowns, toggle groups,
 * checkboxes and cards.
 */
import React from "react";
import { Checkbox as StratoCheckbox, FormField, Label, Select, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Borders } from "@dynatrace/strato-design-tokens";
import { c } from "../theme";

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
  return (
    <div style={{ minWidth: 180, flex: props.wide ? "1 1 320px" : undefined }}>
      <FormField>
        <Label>{props.label}</Label>
        <Select<V>
          value={props.value === "" ? null : props.value}
          onChange={(v) => v !== null && props.onChange(v)}
          disabled={props.disabled}
        >
          <Select.Trigger placeholder={props.placeholder} width="full" />
          <Select.Content>
            {props.options.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
      </FormField>
    </div>
  );
}

export function Segmented<V extends string>(props: {
  label?: string;
  value: V;
  options: (Option<V> & { disabled?: boolean })[];
  onChange: (value: V) => void;
}) {
  return (
    <ToggleButtonGroup value={props.value} onChange={(v) => props.onChange(v as V)} aria-label={props.label}>
      {props.options.map((o) => (
        <ToggleButtonGroup.Item key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </ToggleButtonGroup.Item>
      ))}
    </ToggleButtonGroup>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <StratoCheckbox value={props.checked} onChange={(v) => props.onChange(v)}>
      {props.label}
    </StratoCheckbox>
  );
}

export function Card(props: { children: React.ReactNode; style?: React.CSSProperties; label?: string }) {
  return (
    <section
      aria-label={props.label}
      style={{
        background: c.surface,
        border: `1px solid ${c.line}`,
        borderRadius: Borders.Radius.Surface.Default,
        padding: 16,
        ...props.style,
      }}
    >
      {props.children}
    </section>
  );
}
