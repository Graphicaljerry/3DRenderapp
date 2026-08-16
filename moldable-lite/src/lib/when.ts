/** "just now" / "20m ago" / "3h ago" / "Yesterday" / "14 Aug" / "14 Aug 2025".
 *
 *  Both places that date things for a person — the project shelf and the version list —
 *  span months, so the tail matters: "Yesterday" is how anyone refers to yesterday, and a
 *  bare "14 Aug" on something from last year is a lie by omission. */
export function whenAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 48 * 60) return "Yesterday";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
