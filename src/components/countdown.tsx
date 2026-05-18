import { useNow } from "@/hooks/use-now";
import { formatCountdown } from "@/lib/format";

export function Countdown({ targetIso }: { targetIso: string }) {
  const now = useNow();
  const target = new Date(targetIso).getTime();
  const text = formatCountdown(target, now);
  const expired = target <= now;
  return (
    <span
      className="font-mono text-2xl md:text-3xl font-bold tabular-nums tracking-tight"
      style={{ color: expired ? "var(--alert)" : "var(--forest)" }}
    >
      {expired ? "LOCKED" : text}
    </span>
  );
}
