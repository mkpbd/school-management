/** Display helpers. Money is integer paisa on the wire; dates are 'YYYY-MM-DD' (Asia/Dhaka). */

const TZ = "Asia/Dhaka";
const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 12345678 paisa -> "৳1,23,456.78" (lakh grouping). */
export function formatMoney(paisa: unknown): string {
  const n = typeof paisa === "number" ? paisa : Number(paisa);
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? "-" : ""}৳${money.format(Math.abs(n) / 100)}`;
}

/** "12.50" (taka) -> 1250 paisa. */
export function toPaisa(taka: string | number): number {
  return Math.round(Number(taka) * 100);
}

/** Today in Asia/Dhaka as YYYY-MM-DD. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Current month in Asia/Dhaka as YYYY-MM. */
export function currentPeriod(): string {
  return todayISO().slice(0, 7);
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "on_hold" -> "On hold" */
export function humanize(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Generic cell value. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
