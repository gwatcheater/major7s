import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = {
  tournament_id: string;
  result_type: "podium" | "botr" | "wooden_spoon";
  position: number;
  context: { total_points?: number } | null;
  teams: { nickname: string } | null;
};
type Tour = {
  id: string;
  name: string;
  location: string;
  start_date: string;
  logo_url: string | null;
};

type CellEntry = { nickname: string; points: number | null; tie: boolean };

type AggRow = {
  id: string;
  year: string;
  name: string;
  location: string;
  logo: string | null;
  p1: CellEntry[];
  p2: CellEntry[];
  p3: CellEntry[];
  botr: CellEntry[];
  spoon: CellEntry[];
};

function useHallOfFame() {
  return useQuery({
    queryKey: ["hall-of-fame"],
    queryFn: async (): Promise<AggRow[]> => {
      const [{ data: tours }, { data: results }] = await Promise.all([
        supabase.from("tournaments").select("id,name,location,start_date,logo_url").order("start_date", { ascending: false }),
        supabase.from("tournament_results").select("tournament_id,result_type,position,context,teams(nickname)"),
      ]);
      const rs = (results ?? []) as unknown as Row[];
      const byT = new Map<string, Row[]>();
      for (const r of rs) {
        if (!byT.has(r.tournament_id)) byT.set(r.tournament_id, []);
        byT.get(r.tournament_id)!.push(r);
      }
      const pick = (rows: Row[], type: Row["result_type"], pos: number): CellEntry[] => {
        const m = rows.filter((r) => r.result_type === type && r.position === pos);
        const tie = m.length > 1;
        return m
          .map((r) => ({ nickname: r.teams?.nickname ?? "—", points: r.context?.total_points ?? null, tie }))
          .sort((a, b) => a.nickname.localeCompare(b.nickname));
      };
      return ((tours ?? []) as Tour[])
        .map((t) => {
          const rows = byT.get(t.id) ?? [];
          return {
            id: t.id,
            year: t.start_date?.slice(0, 4) ?? "",
            name: t.name,
            location: t.location,
            logo: t.logo_url,
            p1: pick(rows, "podium", 1),
            p2: pick(rows, "podium", 2),
            p3: pick(rows, "podium", 3),
            botr: pick(rows, "botr", 1),
            spoon: pick(rows, "wooden_spoon", 1),
          };
        })
        .filter((r) => r.p1.length + r.p2.length + r.p3.length + r.botr.length + r.spoon.length > 0);
    },
  });
}

function Cell({ entries }: { entries: CellEntry[] }) {
  if (entries.length === 0) return <span className="text-white/30">—</span>;
  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => (
        <div key={i} className="leading-tight">
          <div className="text-xs font-semibold text-white truncate">
            {e.nickname}
            {e.tie && <span className="ml-1 text-[10px] font-bold" style={{ color: "var(--gold)" }}>(T)</span>}
          </div>
          {e.points != null && <div className="text-[11px] text-white/50 tabular-nums">{e.points} pts</div>}
        </div>
      ))}
    </div>
  );
}

function HallOfFamePage() {
  const { data, isLoading } = useHallOfFame();
  const [chip, setChip] = useState<"all">("all");

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--forest-deep)" }}>
      <div className="px-4 pt-6 pb-4 md:px-12 md:pt-10">
        <div className="flex items-center gap-2 mb-1.5">
          <Trophy className="size-5" style={{ color: "var(--gold)" }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Archive</span>
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase text-white tracking-tight">Hall of Fame</h1>
        <p className="text-xs md:text-sm text-white/50 mt-2">Every tournament. Every champion. Every wooden spoon.</p>

        {/* Chips */}
        <div className="flex gap-2 mt-5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
          <button
            onClick={() => setChip("all")}
            className={cn(
              "shrink-0 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all border",
              chip === "all"
                ? "border-transparent shadow-lg"
                : "border-white/10 text-white/60 hover:text-white hover:border-white/30"
            )}
            style={chip === "all" ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
          >
            All Results
          </button>
        </div>
      </div>

      {/* Sticky table */}
      <div className="relative">
        <div className="overflow-x-auto overflow-y-visible">
          <div className="min-w-[920px] pr-16 md:pr-0">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20" style={{ backgroundColor: "var(--forest-deep)" }}>
                <tr className="border-y border-white/10">
                  <th className="sticky left-0 z-30 text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/60 w-16" style={{ backgroundColor: "var(--forest-deep)" }}>Year</th>
                  <th className="text-left px-2 py-3 text-[10px] font-bold uppercase tracking-widest text-white/60 w-14"></th>
                  <th className="sticky left-[120px] z-30 text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/60 min-w-[160px]" style={{ backgroundColor: "var(--forest-deep)" }}>Tournament</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/60 min-w-[140px]">Location</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest min-w-[140px]" style={{ color: "var(--gold)" }}>1st</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/70 min-w-[140px]">2nd</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/70 min-w-[140px]">3rd</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-white/60 min-w-[140px]">BOTR</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest min-w-[140px]" style={{ color: "var(--alert,#ef4444)" }}>Wooden Spoon</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="text-center py-12 text-white/40 text-sm">Loading…</td></tr>
                )}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-white/40 text-sm">No results yet.</td></tr>
                )}
                {data?.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors align-top">
                    <td className="sticky left-0 z-10 px-3 py-4 font-display text-lg tabular-nums" style={{ backgroundColor: "var(--forest-deep)", color: "var(--gold)" }}>{r.year}</td>
                    <td className="px-2 py-4">
                      {r.logo ? (
                        <img src={r.logo} alt="" className="size-10 object-contain rounded-sm bg-white/5" />
                      ) : (
                        <div className="size-10 rounded-sm bg-white/5 grid place-items-center">
                          <Trophy className="size-4 text-white/30" />
                        </div>
                      )}
                    </td>
                    <td className="sticky left-[120px] z-10 px-3 py-4 text-sm font-semibold text-white" style={{ backgroundColor: "var(--forest-deep)" }}>{r.name}</td>
                    <td className="px-3 py-4 text-xs text-white/60">{r.location}</td>
                    <td className="px-3 py-4"><Cell entries={r.p1} /></td>
                    <td className="px-3 py-4"><Cell entries={r.p2} /></td>
                    <td className="px-3 py-4"><Cell entries={r.p3} /></td>
                    <td className="px-3 py-4"><Cell entries={r.botr} /></td>
                    <td className="px-3 py-4"><Cell entries={r.spoon} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Right-edge scroll affordance gradient */}
        <div
          className="pointer-events-none absolute top-0 right-0 h-full w-16"
          style={{ background: "linear-gradient(to left, var(--forest-deep), transparent)" }}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/hall-of-fame")({
  component: HallOfFamePage,
});
