// =============================================================
// GolferHistoryPanel.tsx
// Opens from a Major History table row. Slide-over panel on desktop,
// full-screen sheet on mobile. Fetches golfer_major_history(owgr_player_id)
// and renders a year × 4-major finish grid: gold win, green top-5/top-10,
// red missed cut, blank = didn't play.
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const MAJORS = ["Masters", "PGA", "US Open", "The Open"] as const;

interface HistRow {
  event_year: number;
  major_type: string;
  finish: number | null;
  made_cut: boolean;
  seed: number | null;
  points_won: number | null;
}

export interface GolferSummary {
  owgr_player_id: number;
  player: string;
  country: string | null;
  majors_played: number;
  wins: number;
  top10s: number;
  best_finish: number | null;
  debut_year: number;
  last_year: number;
}

type Cell = number | "MC" | null;

function cellStyle(v: Cell): { bg: string; fg: string; weight: number; text: string } {
  if (v == null) return { bg: "transparent", fg: "var(--text-muted, #9aa79a)", weight: 400, text: "·" };
  if (v === "MC") return { bg: "transparent", fg: "var(--alert, #ef4444)", weight: 500, text: "MC" };
  if (v === 1) return { bg: "var(--gold)", fg: "var(--forest-deep)", weight: 600, text: "1" };
  if (v <= 5) return { bg: "#97C459", fg: "#173404", weight: 600, text: String(v) };
  if (v <= 10) return { bg: "#C0DD97", fg: "#173404", weight: 600, text: String(v) };
  return { bg: "transparent", fg: "#475569", weight: 400, text: String(v) };
}

export default function GolferHistoryPanel({
  golfer,
  onClose,
}: {
  golfer: GolferSummary;
  onClose: () => void;
}) {
  // slide-in + body scroll lock
  const [shown, setShown] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { data: hist = [], isLoading, error } = useQuery({
    queryKey: ["golfer-major-history", golfer.owgr_player_id],
    queryFn: async (): Promise<HistRow[]> => {
      const { data, error } = await (supabase.rpc as any)("golfer_major_history", {
        p_owgr_player_id: golfer.owgr_player_id,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as HistRow[];
    },
  });

  // flat rows -> { year: { major: cell } }
  const { years, byYear } = useMemo(() => {
    const m = new Map<number, Record<string, Cell>>();
    for (const r of hist) {
      const cell: Cell = r.made_cut ? r.finish : "MC";
      const row = m.get(r.event_year) ?? {};
      row[r.major_type] = cell;
      m.set(r.event_year, row);
    }
    return { years: [...m.keys()].sort((a, b) => b - a), byYear: m };
  }, [hist]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full md:w-[440px] bg-white shadow-2xl overflow-y-auto transition-transform duration-200 ease-out"
        style={{ transform: shown ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="text-base font-semibold truncate" style={{ color: "var(--forest-deep)" }}>{golfer.player}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {golfer.country ? `${golfer.country} · ` : ""}majors {golfer.debut_year}–{golfer.last_year}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        {/* summary chips */}
        <div className="grid grid-cols-4 gap-2 px-4 py-3">
          {[
            { label: "Majors", value: golfer.majors_played },
            { label: "Wins", value: golfer.wins, gold: golfer.wins > 0 },
            { label: "Top 10s", value: golfer.top10s },
            { label: "Best", value: golfer.best_finish ?? "—" },
          ].map((c) => (
            <div key={c.label} className="text-center">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{c.label}</div>
              <div className="text-lg font-mono font-bold tabular-nums mt-0.5"
                style={{ color: (c as any).gold ? "var(--gold)" : "var(--forest-deep)" }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* grid */}
        <div className="px-4 pb-2">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>
          ) : error ? (
            <div className="py-12 text-center text-sm">
              <div className="text-red-600 font-semibold">Couldn’t load history</div>
              <div className="text-slate-500 text-xs font-mono mt-1">{(error as Error).message}</div>
            </div>
          ) : years.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No major appearances on record.</div>
          ) : (
            <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: "3px" }}>
              <thead>
                <tr>
                  <th className="text-left font-medium text-slate-500 text-[11px] px-2 py-1">Year</th>
                  {MAJORS.map((m) => (
                    <th key={m} className="font-medium text-slate-500 text-[11px] px-1 py-1">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}>
                    <td className="text-slate-500 px-2 tabular-nums">{y}</td>
                    {MAJORS.map((m) => {
                      const s = cellStyle((byYear.get(y) ?? {})[m] ?? null);
                      return (
                        <td key={m} className="text-center tabular-nums"
                          style={{ padding: "6px 4px", borderRadius: 6, background: s.bg, color: s.fg, fontWeight: s.weight }}>
                          {s.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* legend */}
        <div className="px-4 py-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-[11px] text-slate-500 border-t border-slate-100">
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "var(--gold)" }} />Win</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "#97C459" }} />Top 5</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "#C0DD97" }} />Top 10</span>
          <span className="inline-flex items-center gap-1.5"><span className="font-semibold" style={{ color: "var(--alert, #ef4444)" }}>MC</span>missed cut</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-slate-400">·</span>did not play</span>
        </div>
      </div>
    </div>
  );
}
