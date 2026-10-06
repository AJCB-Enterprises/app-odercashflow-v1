import { peso } from "../api";

// Months are "YYYY-MM" strings; "now" is the current month in Manila, matching
// how the server buckets orders, not whatever zone this browser is in.
export const thisMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (month: string, style: "long" | "short" = "long") => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: style, year: "numeric", timeZone: "UTC" });
};

export const pctOf = (achieved: number, target: number | null) =>
  target && target > 0 ? Math.round((achieved / target) * 100) : null;

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const now = thisMonth();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <button className="btn sm ghost" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>‹</button>
      <strong style={{ minWidth: 150, textAlign: "center" }}>{monthLabel(month)}</strong>
      <button className="btn sm ghost" aria-label="Next month" disabled={month >= now} onClick={() => onChange(shiftMonth(month, 1))}>›</button>
      {month !== now && <button className="btn sm ghost" onClick={() => onChange(now)}>This month</button>}
    </div>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className={`pbar${pct >= 100 ? " done" : ""}`} role="progressbar" aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function PctChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="dim">—</span>;
  return <span className={`chip ${pct >= 100 ? "green" : "gray"}`}>{pct}%</span>;
}

export const targetNote = (month: string, targetFrom: string | null) =>
  targetFrom && targetFrom !== month ? `Target carried over from ${monthLabel(targetFrom)}.` : null;

export { peso };
