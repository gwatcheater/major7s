export function formatCountdown(targetMs: number, nowMs: number): string {
  let diff = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const d = Math.floor(diff / 86400);
  diff -= d * 86400;
  const h = Math.floor(diff / 3600);
  diff -= h * 3600;
  const m = Math.floor(diff / 60);
  const s = diff - m * 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d)}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

export function tournamentDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const month = s.toLocaleString("en", { month: "long" });
  const year = s.getFullYear();
  return `${month} ${s.getDate()}—${e.getDate()}, ${year}`;
}
