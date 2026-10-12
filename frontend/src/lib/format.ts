/** Times are shown in the browser's local time zone and labelled as such in the UI. */
export const tzLabel = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fmtDate(d?: string | Date | null): string {
  if (!d) return '-';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '-' : x.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}
export const fmtTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString() : '-');

/** null/undefined means "no data yet" and is NEVER shown as 0. */
export function fmtNum(n: number | null | undefined, unit = '', digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'No data yet';
  const v = Number.isInteger(n) ? String(n) : n.toFixed(digits);
  return unit ? `${v} ${unit}` : v;
}
export function fmtMinutes(m?: number | null): string {
  if (m === null || m === undefined) return 'No data yet';
  if (m < 60) return `${Math.round(m * 10) / 10} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}
export const fmtPct = (p: number | null | undefined) =>
  p === null || p === undefined ? 'n/a' : `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;

/** value for <input type="datetime-local"> in local time */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const factorLabels: Record<string, string> = {
  waiting: 'W - Waiting time', urgency: 'U - Urgency', demand: 'D - Parking demand', duration: 'T - Expected duration',
  reservation: 'R - Reservation validity', suitability: 'S - Slot suitability', fairness: 'F - Fairness / aging',
};
