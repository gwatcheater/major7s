import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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
};

type CellEntry = { nickname: string; points: number | null; tie: boolean };

type AggRow = {
  id: string;
  year: string;
  name: string;
  location: string;
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
        supabase.from("tournaments").select("id,name,location,start_date").eq("status", "completed").order("start_date", { ascending: false }),
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

function Cell({ entries, nameColor }: { entries: CellEntry[]; nameColor?: string }) {
  if (entries.length === 0) return <span className="text-slate-300">—</span>;
  const isTie = entries.length > 1;
  const points = entries[0]?.points ?? null;
  const color = nameColor ?? "var(--forest-deep)";
  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => (
        <div key={i} className="text-xs font-semibold truncate leading-tight" style={{ color }}>
          {e.nickname}
        </div>
      ))}
      {points != null && (
        <div className="text-[11px] text-slate-500 tabular-nums text-left pt-0.5">
          {points} pts{isTie && <span className="ml-1 font-bold" style={{ color: "var(--gold)" }}>(T)</span>}
        </div>
      )}
    </div>
  );
}

function ChipButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all border",
        active
          ? "border-transparent shadow-lg"
          : "border-slate-200 text-slate-500 hover:text-[color:var(--forest-deep)] hover:border-slate-400",
      )}
      style={active ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
    >
      {label}
    </button>
  );
}

function SubChipButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  // Same colour treatment as the top-level ChipButton (gold-on-forest-deep when active)
  // so the two button rows feel consistent and readable.
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border",
        active
          ? "border-transparent shadow-lg"
          : "border-slate-200 text-slate-500 hover:text-[color:var(--forest-deep)] hover:border-slate-400",
      )}
      style={active ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
    >
      {label}
    </button>
  );
}

type VaultCategory = "chasing_majors" | "oom";
type VaultSortKey =
  | "rank"
  | "team"
  // Chasing Majors
  | "masters"
  | "pga"
  | "usopen"
  | "theopen"
  | "slam"
  // OOM
  | "firsts"
  | "seconds"
  | "thirds"
  | "top10"
  | "last"
  | "points";

interface ChasingMajorsRow {
  team_id: string;
  nickname: string;
  bestByMajor: Record<string, number | null>; // major full name -> best position (1/2/3) or null
  slamDistinctMajorsWon: number;               // 0-4
  totalWins: number;                            // count of position=1 podiums across all majors
  totalPodiums: number;                         // count of any podium (pos 1/2/3)
}

const MAJOR_FULL_NAMES = [
  "Masters Tournament",
  "PGA Championship",
  "U.S. Open",
  "The Open Championship",
] as const;
const MAJOR_SHORT: Record<string, string> = {
  "Masters Tournament": "Masters",
  "PGA Championship": "PGA",
  "U.S. Open": "U.S. Open",
  "The Open Championship": "The Open",
};

function useChasingMajors() {
  return useQuery({
    queryKey: ["chasing-majors"],
    queryFn: async (): Promise<ChasingMajorsRow[]> => {
      // Pull tournaments (for major-name lookup) and all podium rows.
      const [{ data: tours }, { data: results }] = await Promise.all([
        supabase.from("tournaments").select("id,name").eq("status", "completed"),
        supabase
          .from("tournament_results")
          .select("tournament_id,team_id,result_type,position,teams(nickname)")
          .eq("result_type", "podium"),
      ]);
      const tourNameById = new Map<string, string>();
      for (const t of (tours ?? []) as Array<{ id: string; name: string }>) {
        tourNameById.set(t.id, t.name);
      }

      interface Acc {
        nickname: string;
        bestByMajor: Record<string, number | null>;
        winsByMajor: Set<string>;
        totalWins: number;
        totalPodiums: number;
      }
      const byTeam = new Map<string, Acc>();

      for (const r of (results ?? []) as unknown as Array<{
        tournament_id: string;
        team_id: string;
        position: number;
        teams: { nickname: string } | null;
      }>) {
        const majorName = tourNameById.get(r.tournament_id);
        if (!majorName || !MAJOR_FULL_NAMES.includes(majorName as any)) continue;
        const nickname = r.teams?.nickname ?? "—";

        let acc = byTeam.get(r.team_id);
        if (!acc) {
          acc = {
            nickname,
            bestByMajor: Object.fromEntries(MAJOR_FULL_NAMES.map((m) => [m, null])),
            winsByMajor: new Set<string>(),
            totalWins: 0,
            totalPodiums: 0,
          };
          byTeam.set(r.team_id, acc);
        }
        // Best (lowest) finish per major.
        const cur = acc.bestByMajor[majorName];
        if (cur === null || r.position < cur) acc.bestByMajor[majorName] = r.position;
        // Wins tracking.
        if (r.position === 1) {
          acc.totalWins++;
          acc.winsByMajor.add(majorName);
        }
        acc.totalPodiums++;
      }

      const out: ChasingMajorsRow[] = [];
      for (const [team_id, acc] of byTeam) {
        out.push({
          team_id,
          nickname: acc.nickname,
          bestByMajor: acc.bestByMajor,
          slamDistinctMajorsWon: acc.winsByMajor.size,
          totalWins: acc.totalWins,
          totalPodiums: acc.totalPodiums,
        });
      }
      return out;
    },
  });
}

function MobileResultCard({ row }: { row: AggRow }) {
  // Vertical sections: 1st, 2nd, 3rd, BOTR, Wooden Spoon.
  // Each section renders a small "icon | label | team(s) | points" row.
  // Hide a section entirely if no team finished in that category for this tournament.
  const sections: Array<{
    key: string;
    label: string;
    icon: string;
    iconColor: string;
    entries: CellEntry[];
  }> = [
    { key: "p1",    label: "1ST",  icon: "●", iconColor: "var(--gold)",       entries: row.p1 },
    { key: "p2",    label: "2ND",  icon: "●", iconColor: "#7d7d7d",            entries: row.p2 },
    { key: "p3",    label: "3RD",  icon: "●", iconColor: "#c98447",            entries: row.p3 },
    { key: "botr",  label: "BOTR", icon: "●", iconColor: "var(--forest-deep)", entries: row.botr },
    { key: "spoon", label: "LAST", icon: "●", iconColor: "#dc2626",            entries: row.spoon },
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* Header: year, tournament, location (year and tourney on one line; location on second) */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-bold text-xs tabular-nums shrink-0" style={{ color: "var(--gold)" }}>
            {row.year}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>
            {row.name}
          </span>
        </div>
        {row.location && (
          <div className="text-[11px] text-slate-500 mt-0.5 leading-tight truncate">
            {row.location}
          </div>
        )}
      </div>

      {/* Sections: each result type on its own row, hidden if empty */}
      <div className="divide-y divide-slate-100">
        {sections.map((sec) => {
          if (sec.entries.length === 0) return null;
          return (
            <div key={sec.key} className="px-3 py-2 flex items-start gap-3">
              {/* Icon + label */}
              <div className="flex items-center gap-1.5 shrink-0 w-14">
                <span className="text-[10px] leading-none" style={{ color: sec.iconColor }}>
                  {sec.icon}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {sec.label}
                </span>
              </div>
              {/* Team name(s) — stack vertically for ties */}
              <div className="flex-1 min-w-0">
                {sec.entries.map((e, i) => (
                  <div key={i} className="text-sm font-semibold leading-snug" style={{ color: "var(--forest-deep)" }}>
                    {e.nickname}
                  </div>
                ))}
              </div>
              {/* Points (right-aligned; first entry's points; T marker if tied) */}
              <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0 text-right leading-snug pt-0.5">
                {sec.entries[0]?.points != null && (
                  <>
                    {sec.entries[0].points} pts
                    {sec.entries.length > 1 && (
                      <span className="ml-1 font-bold" style={{ color: "var(--gold)" }}>(T)</span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface OomRow {
  team_id: string;
  nickname: string;
  firsts: number;
  seconds: number;
  thirds: number;
  top10: number;          // count of top-10 finishes from tournament_scores (includes 1/2/3)
  last: number;           // wooden_spoon rows
  points: number;         // OOM points
}

// OOM points: 10 pts for 1st, 5 pts for 2nd, 2 pts for 3rd, 1 pt for top-10 (positions 4-10),
// minus 10 for last place. Top-10 and podium are *separate* in the points calc — a 1st-place
// finish earns 10 (not 10+1), so we count Top-10 as positions 4-10 ONLY for the points sum,
// but display the full "top 10 incl. podium" count in the Top 10 column per the spec wording.
function calcOomPoints(r: { firsts: number; seconds: number; thirds: number; top10IncludingPodium: number; last: number }) {
  // Positions 4-10 only contribute the 1pt-each tier, since podium is already paid out at 10/5/2.
  const topNonPodium = Math.max(0, r.top10IncludingPodium - r.firsts - r.seconds - r.thirds);
  return r.firsts * 10 + r.seconds * 5 + r.thirds * 2 + topNonPodium * 1 - r.last * 10;
}

function useOom() {
  return useQuery({
    queryKey: ["oom"],
    queryFn: async (): Promise<OomRow[]> => {
      // We need three things:
      //   1) tournament_results rows (podium + wooden_spoon) for COMPLETED tournaments only,
      //      joined to teams for nickname.
      //   2) tournament_scores rows for the same tournaments to count top-10 finishes
      //      (position_numeric <= 10).
      //   3) The list of completed tournament ids to filter both queries.

      const [{ data: completedTours }] = await Promise.all([
        supabase.from("tournaments").select("id").eq("status", "completed"),
      ]);
      const completedIds = new Set(((completedTours ?? []) as Array<{ id: string }>).map((t) => t.id));
      if (completedIds.size === 0) return [];

      const [{ data: results }, { data: scores }] = await Promise.all([
        supabase
          .from("tournament_results")
          .select("tournament_id,team_id,result_type,position,teams(nickname)")
          .in("result_type", ["podium", "wooden_spoon"]),
        supabase
          .from("tournament_scores")
          .select("tournament_id,team_id,position_numeric,teams(nickname)"),
      ]);

      interface Acc {
        nickname: string;
        firsts: number;
        seconds: number;
        thirds: number;
        top10IncludingPodium: number;
        last: number;
      }
      const byTeam = new Map<string, Acc>();

      const ensure = (team_id: string, nickname: string) => {
        let a = byTeam.get(team_id);
        if (!a) {
          a = { nickname, firsts: 0, seconds: 0, thirds: 0, top10IncludingPodium: 0, last: 0 };
          byTeam.set(team_id, a);
        }
        return a;
      };

      // Pass 1: podium + wooden_spoon counts from tournament_results
      for (const r of (results ?? []) as unknown as Array<{
        tournament_id: string;
        team_id: string;
        result_type: string;
        position: number;
        teams: { nickname: string } | null;
      }>) {
        if (!completedIds.has(r.tournament_id)) continue;
        const a = ensure(r.team_id, r.teams?.nickname ?? "—");
        if (r.result_type === "podium") {
          if (r.position === 1) a.firsts++;
          else if (r.position === 2) a.seconds++;
          else if (r.position === 3) a.thirds++;
        } else if (r.result_type === "wooden_spoon") {
          a.last++;
        }
      }

      // Pass 2: top-10 finishes (position_numeric 1..10) from tournament_scores
      for (const s of (scores ?? []) as unknown as Array<{
        tournament_id: string;
        team_id: string;
        position_numeric: number;
        teams: { nickname: string } | null;
      }>) {
        if (!completedIds.has(s.tournament_id)) continue;
        if (s.position_numeric <= 10) {
          const a = ensure(s.team_id, s.teams?.nickname ?? "—");
          a.top10IncludingPodium++;
        }
      }

      const out: OomRow[] = [];
      for (const [team_id, a] of byTeam) {
        out.push({
          team_id,
          nickname: a.nickname,
          firsts: a.firsts,
          seconds: a.seconds,
          thirds: a.thirds,
          top10: a.top10IncludingPodium,
          last: a.last,
          points: calcOomPoints({
            firsts: a.firsts,
            seconds: a.seconds,
            thirds: a.thirds,
            top10IncludingPodium: a.top10IncludingPodium,
            last: a.last,
          }),
        });
      }
      return out;
    },
  });
}

function OomView() {
  const { data = [], isLoading } = useOom();
  const [sortKey, setSortKey] = useState<VaultSortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Spec sort: Points desc, then 1sts desc, then 2nds desc, then 3rds desc.
  const ranked = useMemo(() => {
    const baseSorted = [...data].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.firsts !== a.firsts) return b.firsts - a.firsts;
      if (b.seconds !== a.seconds) return b.seconds - a.seconds;
      if (b.thirds !== a.thirds) return b.thirds - a.thirds;
      return a.nickname.localeCompare(b.nickname);
    });
    let lastKey = "";
    let lastRank = 0;
    const withRanks = baseSorted.map((r, i) => {
      const key = `${r.points}|${r.firsts}|${r.seconds}|${r.thirds}`;
      const rank = key === lastKey ? lastRank : i + 1;
      lastKey = key;
      lastRank = rank;
      return { ...r, rank };
    });
    const rankCounts = new Map<number, number>();
    for (const r of withRanks) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);
    return withRanks.map((r) => ({ ...r, tied: (rankCounts.get(r.rank) ?? 0) > 1 }));
  }, [data]);

  const sorted = useMemo(() => {
    const arr = [...ranked];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "rank":   arr.sort((a, b) => dir * (a.rank - b.rank)); break;
      case "team":   arr.sort((a, b) => dir * a.nickname.localeCompare(b.nickname)); break;
      case "firsts": arr.sort((a, b) => dir * (a.firsts - b.firsts)); break;
      case "seconds":arr.sort((a, b) => dir * (a.seconds - b.seconds)); break;
      case "thirds": arr.sort((a, b) => dir * (a.thirds - b.thirds)); break;
      case "top10":  arr.sort((a, b) => dir * (a.top10 - b.top10)); break;
      case "last":   arr.sort((a, b) => dir * (a.last - b.last)); break;
      case "points": arr.sort((a, b) => dir * (a.points - b.points)); break;
    }
    return arr;
  }, [ranked, sortKey, sortDir]);

  function toggleSort(k: VaultSortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  if (isLoading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>;
  if (sorted.length === 0) return <div className="text-center py-12 text-slate-400 text-sm">No completed tournaments yet.</div>;

  return (
    <div className="relative max-w-3xl mx-auto px-4 md:px-12">
      {/* Desktop sortable table */}
      <div className="hidden md:block overflow-x-auto overflow-y-visible">
        <div className="min-w-[620px]">
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-y border-slate-200">
                <SortHeader label="Rank"    k="rank"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-0"  widthClass="w-14" />
                <SortHeader label="Team"    k="team"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-14" widthClass="w-40" />
                <SortHeader label="1st"     k="firsts"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-14 text-center whitespace-nowrap" align="center" />
                <SortHeader label="2nd"     k="seconds" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-14 text-center whitespace-nowrap" align="center" />
                <SortHeader label="3rd"     k="thirds"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-14 text-center whitespace-nowrap" align="center" />
                <SortHeader label="Top 10"  k="top10"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-16 text-center whitespace-nowrap" align="center" />
                <SortHeader label="Last"    k="last"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-14 text-center whitespace-nowrap" align="center" />
                <SortHeader label="Points"  k="points"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-16 text-center whitespace-nowrap" align="center" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.team_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 z-10 px-2 py-3 text-left text-xs font-mono font-bold tabular-nums bg-white" style={{ color: "var(--gold)" }}>
                    {r.tied ? `T${r.rank}` : r.rank}
                  </td>
                  <td className="sticky left-14 z-10 px-2 py-3 text-left text-xs font-semibold bg-white truncate" style={{ color: "var(--forest-deep)" }}>
                    {r.nickname}
                  </td>
                  <OomCountCell value={r.firsts}  color="var(--gold)" />
                  <OomCountCell value={r.seconds} color="#7d7d7d" />
                  <OomCountCell value={r.thirds}  color="#c98447" />
                  <OomCountCell value={r.top10}   color="var(--forest-deep)" />
                  <OomCountCell value={r.last}    color="var(--alert,#ef4444)" />
                  <td className="px-2 py-3 text-center text-sm font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>
                    {r.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {sorted.map((r) => (
          <MobileOomCard key={r.team_id} row={r} />
        ))}
      </div>
    </div>
  );
}

function OomCountCell({ value, color }: { value: number; color: string }) {
  // Zero values are de-emphasised (slate-300 dash-like feel) so the eye focuses on
  // the teams that actually have something to show.
  if (value === 0) {
    return <td className="px-2 py-3 text-center text-xs text-slate-300">0</td>;
  }
  return (
    <td className="px-2 py-3 text-center text-xs font-mono font-bold tabular-nums" style={{ color }}>
      {value}
    </td>
  );
}

function MobileOomCard({ row }: { row: OomRow & { rank: number; tied?: boolean } }) {
  const rankLabel = row.tied ? `T${row.rank}` : row.rank;
  const cells: Array<{ label: string; value: number; color: string }> = [
    { label: "1ST",    value: row.firsts,  color: "var(--gold)" },
    { label: "2ND",    value: row.seconds, color: "#7d7d7d" },
    { label: "3RD",    value: row.thirds,  color: "#c98447" },
    { label: "TOP 10", value: row.top10,   color: "var(--forest-deep)" },
    { label: "LAST",   value: row.last,    color: "var(--alert,#ef4444)" },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      {/* Header: rank + team on left, points top-right */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="font-mono font-bold text-sm tabular-nums shrink-0" style={{ color: "var(--gold)" }}>
            {rankLabel}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>
            {row.nickname}
          </span>
        </div>
        <div className="text-base font-mono font-bold tabular-nums shrink-0" style={{ color: "var(--forest-deep)" }}>
          {row.points}
          <span className="text-[10px] font-semibold text-slate-400 ml-1">pts</span>
        </div>
      </div>

      {/* 5-column counts grid: labels row, then values row */}
      <div className="grid grid-cols-5 gap-1 text-center">
        {cells.map((c) => (
          <div key={c.label} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
            {c.label}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={`${c.label}-v`}
            className="text-base font-mono font-bold tabular-nums leading-none mt-1"
            style={{ color: c.value === 0 ? "#cbd5e1" : c.color }}
          >
            {c.value}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChasingMajorsView() {
  const { data = [], isLoading } = useChasingMajors();
  const [sortKey, setSortKey] = useState<VaultSortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Base sort follows the spec: Slam desc, totalWins desc, totalPodiums desc.
  // Use that to compute Rank, THEN apply user-clicked sort on top if any.
  const ranked = useMemo(() => {
    const baseSorted = [...data].sort((a, b) => {
      if (b.slamDistinctMajorsWon !== a.slamDistinctMajorsWon)
        return b.slamDistinctMajorsWon - a.slamDistinctMajorsWon;
      if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
      if (b.totalPodiums !== a.totalPodiums) return b.totalPodiums - a.totalPodiums;
      return a.nickname.localeCompare(b.nickname);
    });
    // Assign ranks with shared positions for exact ties on (slam, wins, podiums).
    let lastKey = "";
    let lastRank = 0;
    const withRanks = baseSorted.map((r, i) => {
      const key = `${r.slamDistinctMajorsWon}|${r.totalWins}|${r.totalPodiums}`;
      const rank = key === lastKey ? lastRank : i + 1;
      lastKey = key;
      lastRank = rank;
      return { ...r, rank };
    });
    // Second pass: flag rows whose rank is shared by at least one other team.
    const rankCounts = new Map<number, number>();
    for (const r of withRanks) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);
    return withRanks.map((r) => ({ ...r, tied: (rankCounts.get(r.rank) ?? 0) > 1 }));
  }, [data]);

  const sorted = useMemo(() => {
    const arr = [...ranked];
    const dir = sortDir === "asc" ? 1 : -1;
    const cmpNullable = (a: number | null, b: number | null) => {
      // null means no podium in that major — lower priority than any real finish.
      // For ascending: nulls go last; for descending: nulls go last too (always least-relevant).
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    };
    switch (sortKey) {
      case "rank":
        arr.sort((a, b) => dir * (a.rank - b.rank));
        break;
      case "team":
        arr.sort((a, b) => dir * a.nickname.localeCompare(b.nickname));
        break;
      case "slam":
        arr.sort((a, b) => dir * (a.slamDistinctMajorsWon - b.slamDistinctMajorsWon));
        break;
      case "masters":
        arr.sort((a, b) => dir * cmpNullable(a.bestByMajor["Masters Tournament"], b.bestByMajor["Masters Tournament"]));
        break;
      case "pga":
        arr.sort((a, b) => dir * cmpNullable(a.bestByMajor["PGA Championship"], b.bestByMajor["PGA Championship"]));
        break;
      case "usopen":
        arr.sort((a, b) => dir * cmpNullable(a.bestByMajor["U.S. Open"], b.bestByMajor["U.S. Open"]));
        break;
      case "theopen":
        arr.sort((a, b) => dir * cmpNullable(a.bestByMajor["The Open Championship"], b.bestByMajor["The Open Championship"]));
        break;
    }
    return arr;
  }, [ranked, sortKey, sortDir]);

  function toggleSort(k: VaultSortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  if (isLoading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>;
  }
  if (sorted.length === 0) {
    return <div className="text-center py-12 text-slate-400 text-sm">No podium finishes yet.</div>;
  }

  return (
    <div className="relative max-w-3xl mx-auto px-4 md:px-12">
      {/* Desktop: dense sortable table */}
      <div className="hidden md:block px-4 md:px-12 overflow-x-auto overflow-y-visible">
        <div className="min-w-[620px]">
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-y border-slate-200">
                <SortHeader label="Rank"      k="rank"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-0" widthClass="w-14" />
                <SortHeader label="Team"      k="team"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-14" widthClass="w-40" />
                <SortHeader label="Masters"   k="masters"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-20 whitespace-nowrap" align="center" />
                <SortHeader label="PGA"       k="pga"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-20 whitespace-nowrap" align="center" />
                <SortHeader label="U.S. Open" k="usopen"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-24 whitespace-nowrap" align="center" />
                <SortHeader label="The Open"  k="theopen"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-20 whitespace-nowrap" align="center" />
                <SortHeader label="Slam"      k="slam"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-16 whitespace-nowrap" align="center" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.team_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 z-10 px-2 py-3 text-left text-xs font-mono font-bold tabular-nums bg-white" style={{ color: "var(--gold)" }}>
                    {r.tied ? `T${r.rank}` : r.rank}
                  </td>
                  <td className="sticky left-14 z-10 px-2 py-3 text-left text-xs font-semibold text-[color:var(--forest-deep)] bg-white truncate">
                    {r.nickname}
                  </td>
                  <PositionCell value={r.bestByMajor["Masters Tournament"]} />
                  <PositionCell value={r.bestByMajor["PGA Championship"]} />
                  <PositionCell value={r.bestByMajor["U.S. Open"]} />
                  <PositionCell value={r.bestByMajor["The Open Championship"]} />
                  <td className="px-2 py-3 text-center text-xs font-mono tabular-nums text-[color:var(--forest-deep)]">
                    <span className={r.slamDistinctMajorsWon === 4 ? "font-bold" : ""} style={r.slamDistinctMajorsWon === 4 ? { color: "var(--gold)" } : undefined}>
                      {r.slamDistinctMajorsWon}
                    </span>
                    <span className="text-slate-400">/4</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Desktop scroll affordance (only when desktop table is visible) */}
      <div
        className="hidden md:block pointer-events-none absolute top-0 right-0 h-full w-16"
        style={{ background: "linear-gradient(to left, white, transparent)" }}
      />

      {/* Mobile: one card per team, vertical stack. Sorted by spec rule. */}
      <div className="md:hidden space-y-2">
        {sorted.map((r) => (
          <MobileTeamCard key={r.team_id} row={r} />
        ))}
      </div>
    </div>
  );
}

function MobileTeamCard({ row }: { row: ChasingMajorsRow & { rank: number; tied?: boolean } }) {
  const rankLabel = row.tied ? `T${row.rank}` : row.rank;
  const majors: Array<{ label: string; value: number | null }> = [
    { label: "MASTERS",   value: row.bestByMajor["Masters Tournament"] },
    { label: "PGA",       value: row.bestByMajor["PGA Championship"] },
    { label: "U.S. OPEN", value: row.bestByMajor["U.S. Open"] },
    { label: "THE OPEN",  value: row.bestByMajor["The Open Championship"] },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      {/* Header: rank close to team name on left, slam top-right */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span
            className="font-mono font-bold text-sm tabular-nums shrink-0"
            style={{ color: "var(--gold)" }}
          >
            {rankLabel}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>
            {row.nickname}
          </span>
        </div>
        <div className="text-sm font-mono tabular-nums shrink-0">
          <span
            className={row.slamDistinctMajorsWon === 4 ? "font-bold" : "font-semibold"}
            style={row.slamDistinctMajorsWon === 4 ? { color: "var(--gold)" } : { color: "var(--forest-deep)" }}
          >
            {row.slamDistinctMajorsWon}
          </span>
          <span className="text-slate-400">/4</span>
        </div>
      </div>

      {/* Major positions: labels row + values row, tightly stacked */}
      <div className="grid grid-cols-4 gap-1 text-center">
        {majors.map((m) => (
          <div key={m.label} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
            {m.label}
          </div>
        ))}
        {majors.map((m) => {
          const color =
            m.value === 1 ? "var(--gold)" :
            m.value === 2 ? "#7d7d7d" :
            m.value === 3 ? "#c98447" : "#cbd5e1";
          return (
            <div
              key={`${m.label}-v`}
              className="text-base font-mono font-bold tabular-nums leading-none mt-1"
              style={{ color }}
            >
              {m.value === null ? "—" : m.value}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortHeader({
  label, k, sortKey, sortDir, onClick, sticky, widthClass, align = "left",
}: {
  label: string;
  k: VaultSortKey;
  sortKey: VaultSortKey;
  sortDir: "asc" | "desc";
  onClick: (k: VaultSortKey) => void;
  sticky?: string;
  widthClass?: string;
  align?: "left" | "center";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  const stickyCls = sticky ? `sticky ${sticky} z-30 bg-white` : "";
  // The button is laid out as a flex container so we can control the cross-axis
  // alignment of label+arrow. justify-center makes the button content sit in the
  // middle of the cell width when align="center".
  const justify = align === "center" ? "justify-center" : "justify-start";
  const textAlignCls = align === "center" ? "text-center" : "text-left";
  return (
    <th className={`${textAlignCls} px-2 py-3 text-[10px] font-bold uppercase tracking-widest ${widthClass ?? ""} ${stickyCls}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`w-full inline-flex items-center gap-1 ${justify} ${active ? "text-[color:var(--forest-deep)]" : "text-slate-500 hover:text-[color:var(--forest-deep)]"}`}
      >
        {label}
        <span className="text-[8px]">{arrow}</span>
      </button>
    </th>
  );
}

function PositionCell({ value }: { value: number | null }) {
  if (value === null) {
    return <td className="px-2 py-3 text-center text-xs text-slate-300">—</td>;
  }
  // Gold/silver/bronze tints for 1/2/3.
  const color =
    value === 1 ? "var(--gold)" :
    value === 2 ? "#d3d3d3" :
    value === 3 ? "#c98447" : "white";
  return (
    <td className="px-2 py-3 text-center text-xs font-mono font-bold tabular-nums" style={{ color }}>
      {value}
    </td>
  );
}

function HallOfFamePage() {
  const { data, isLoading } = useHallOfFame();
  type View = "results" | "vault";
  const [view, setView] = useState<View>("results");
  const [vaultCategory, setVaultCategory] = useState<VaultCategory>("chasing_majors");

  return (
    <div className="min-h-screen bg-white">
      <div className="px-4 pt-6 pb-4 md:px-12 md:pt-10">
        <div className="flex items-center gap-2 mb-1.5">
          <Trophy className="size-5" style={{ color: "var(--gold)" }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Archive</span>
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase tracking-tight" style={{ color: "var(--forest-deep)" }}>Hall of Fame</h1>
        <p className="text-xs md:text-sm text-slate-500 mt-2">Every tournament. Every champion. Every wooden spoon.</p>

        {/* Top-level view toggle */}
        <div className="flex gap-2 mt-5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
          <ChipButton
            label="All Results"
            active={view === "results"}
            onClick={() => setView("results")}
          />
          <ChipButton
            label="The Vault"
            active={view === "vault"}
            onClick={() => setView("vault")}
          />
        </div>

        {/* Vault sub-buttons */}
        {view === "vault" && (
          <div className="flex gap-2 mt-3 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
            <SubChipButton
              label="Chasing Majors"
              active={vaultCategory === "chasing_majors"}
              onClick={() => setVaultCategory("chasing_majors")}
            />
            <SubChipButton
              label="OOM"
              active={vaultCategory === "oom"}
              onClick={() => setVaultCategory("oom")}
            />
          </div>
        )}
      </div>

      {/* Sticky All Results table */}
      {view === "results" && (
      <div className="relative">
        {/* Desktop: full table with sticky Year + Tournament columns. */}
        <div className="hidden md:block overflow-x-auto overflow-y-visible">
          <div className="min-w-[860px] pr-16 md:pr-0">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-y border-slate-200">
                  <th className="sticky left-0 z-30 text-left px-2 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-14 bg-white">Year</th>
                  <th className="sticky left-14 z-30 text-left px-2 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[180px] bg-white">Tournament</th>
                  <th className="text-left px-2 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[180px] whitespace-nowrap">Location</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest w-[120px]" style={{ color: "var(--gold)" }}>1st</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 w-[120px]">2nd</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 w-[120px]">3rd</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[120px]">BOTR</th>
                  <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest w-[120px]" style={{ color: "var(--alert,#ef4444)" }}>Last Place</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">Loading…</td></tr>
                )}
                {!isLoading && (data?.length ?? 0) === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No results yet.</td></tr>
                )}
                {data?.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors align-top">
                    <td className="sticky left-0 z-20 px-2 py-4 text-left text-xs font-semibold tabular-nums bg-white leading-tight text-[color:var(--forest-deep)]">{r.year}</td>
                    <td className="sticky left-14 z-20 px-2 py-4 text-left text-xs font-semibold text-[color:var(--forest-deep)] whitespace-normal bg-white leading-tight">{r.name}</td>
                    <td className="px-2 py-4 text-left text-xs font-semibold text-slate-500 whitespace-nowrap leading-tight">{r.location}</td>
                    <td className="px-3 py-4"><Cell entries={r.p1} nameColor="var(--gold)" /></td>
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
        {/* Right-edge scroll affordance gradient (desktop only) */}
        <div
          className="hidden md:block pointer-events-none absolute top-0 right-0 h-full w-16"
          style={{ background: "linear-gradient(to left, white, transparent)" }}
        />

        {/* Mobile: one card per tournament, vertical sections inside each card. */}
        <div className="md:hidden space-y-3 px-4">
          {data?.map((r) => <MobileResultCard key={r.id} row={r} />)}
        </div>
      </div>
      )}

      {/* Vault view */}
      {view === "vault" && (
        <div className="px-4 md:px-12 pt-4 pb-12">
          {vaultCategory === "chasing_majors" && <ChasingMajorsView />}
          {vaultCategory === "oom" && <OomView />}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/hall-of-fame")({
  component: HallOfFamePage,
});
