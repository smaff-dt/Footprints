const intFmt = new Intl.NumberFormat("en-US");

export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

export function formatPct(ratio: number): string {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

export function formatAvg(n: number): string {
  return n.toFixed(1);
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function deviceName(device: string): string {
  const names: Record<string, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile", all: "Desktop" };
  return names[device] ?? device;
}

/** "Today, 11:16", "Yesterday, 09:02", "Oct 18" (or "Oct 18, 2025" in another year). */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
