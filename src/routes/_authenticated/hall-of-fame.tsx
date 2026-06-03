import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTeams } from "@/hooks/use-teams";
// =============================================================
// Paginated fetcher — wraps a Supabase query builder so we can fetch arbitrary
// numbers of rows without hitting PostgREST's default 1000-row cap. The cap was
// silently truncating results across Hall of Fame views (Rob Parker's 12th
// tournament_scores row was being dropped, etc.).
//
// Usage:
//   const rows = await fetchAll(
//     () => supabase.from("tournament_scores").select("..."),
//   );
// =============================================================
async function fetchAll<T>(
  buildQuery: () => { range: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }> },
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety: hard cap at 100 pages (100k rows) to avoid runaway loops.
  for (let page = 0; page < 100; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}


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
      const [{ data: tours }, results] = await Promise.all([
        supabase.from("tournaments").select("id,name,location,start_date").eq("status", "completed").order("start_date", { ascending: false }),
        fetchAll<Row>(() =>
          supabase
            .from("tournament_results")
            .select("tournament_id,result_type,position,context,teams(nickname)") as any,
        ),
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

type VaultCategory = "chasing_majors" | "oom" | "points" | "head_to_head";
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
  | "points"
  // Points view
  | "tournaments"
  | "avgPoints"
  | "avgPosition";

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
      const { data: tours } = await supabase
        .from("tournaments").select("id,name").eq("status", "completed");
      const tourList = (tours ?? []) as Array<{ id: string; name: string }>;
      if (tourList.length === 0) return [];
      const completedIdList = tourList.map((t) => t.id);
      // Filter podium results server-side by the completed tournament list to
      // keep the payload small on mobile connections.
      const results = await fetchAll<{
        tournament_id: string;
        team_id: string;
        result_type: string;
        position: number;
        teams: { nickname: string } | null;
      }>(() =>
        supabase
          .from("tournament_results")
          .select("tournament_id,team_id,result_type,position,teams(nickname)")
          .eq("result_type", "podium")
          .in("tournament_id", completedIdList) as any,
      );
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

      for (const r of results) {
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

      const { data: completedTours } = await supabase
        .from("tournaments").select("id").eq("status", "completed");
      const completedIdList = ((completedTours ?? []) as Array<{ id: string }>).map((t) => t.id);
      if (completedIdList.length === 0) return [];
      const completedIds = new Set(completedIdList);

      // Both queries pull through fetchAll to bypass PostgREST's default
      // 1000-row cap, which was silently dropping rows in larger payloads.
      const [results, scores] = await Promise.all([
        fetchAll<{
          tournament_id: string;
          team_id: string;
          result_type: string;
          position: number;
          teams: { nickname: string } | null;
        }>(() =>
          supabase
            .from("tournament_results")
            .select("tournament_id,team_id,result_type,position,teams(nickname)")
            .in("result_type", ["podium", "wooden_spoon"])
            .in("tournament_id", completedIdList) as any,
        ),
        fetchAll<{
          tournament_id: string;
          team_id: string;
          position_numeric: number;
          teams: { nickname: string } | null;
        }>(() =>
          supabase
            .from("tournament_scores")
            .select("tournament_id,team_id,position_numeric,teams(nickname)")
            .in("tournament_id", completedIdList) as any,
        ),
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
      for (const r of results) {
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
      for (const s of scores) {
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

interface PointsRow {
  team_id: string;
  nickname: string;
  tournaments: number;     // count of tournament_scores rows for this team (completed only)
  avgPoints: number;
  avgPosition: number;
}

function usePointsView() {
  return useQuery({
    queryKey: ["points-view"],
    queryFn: async (): Promise<PointsRow[]> => {
      // Same completed-only filter pattern as OOM — server-side .in() keeps
      // payloads manageable on mobile.
      const { data: completedTours } = await supabase
        .from("tournaments").select("id").eq("status", "completed");
      const completedIdList = ((completedTours ?? []) as Array<{ id: string }>).map((t) => t.id);
      if (completedIdList.length === 0) return [];

      const scores = await fetchAll<{
        team_id: string;
        total_points: number;
        position_numeric: number;
        teams: { nickname: string } | null;
      }>(() =>
        supabase
          .from("tournament_scores")
          .select("team_id,total_points,position_numeric,teams(nickname)")
          .in("tournament_id", completedIdList) as any,
      );

      interface Acc {
        nickname: string;
        tournaments: number;
        sumPoints: number;
        sumPosition: number;
      }
      const byTeam = new Map<string, Acc>();
      for (const r of scores) {
        let a = byTeam.get(r.team_id);
        if (!a) {
          a = { nickname: r.teams?.nickname ?? "—", tournaments: 0, sumPoints: 0, sumPosition: 0 };
          byTeam.set(r.team_id, a);
        }
        a.tournaments++;
        a.sumPoints += r.total_points;
        a.sumPosition += r.position_numeric;
      }

      const out: PointsRow[] = [];
      for (const [team_id, a] of byTeam) {
        out.push({
          team_id,
          nickname: a.nickname,
          tournaments: a.tournaments,
          avgPoints: a.tournaments > 0 ? a.sumPoints / a.tournaments : 0,
          avgPosition: a.tournaments > 0 ? a.sumPosition / a.tournaments : 0,
        });
      }
      return out;
    },
  });
}

function PointsView() {
  const { data = [], isLoading } = usePointsView();
  const [sortKey, setSortKey] = useState<VaultSortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Minimum-tournaments filter — "None" (0) lets every team through.
  const [minTournaments, setMinTournaments] = useState<number>(0);

  // Spec sort: lowest avgPoints first (best), tie-break by lower avgPosition,
  // then by tournament count descending (more tournaments => more reliable).
  // The filter is applied BEFORE ranking so ranks reflect the visible cohort.
  const filtered = useMemo(
    () => data.filter((r) => r.tournaments >= minTournaments),
    [data, minTournaments],
  );
  const ranked = useMemo(() => {
    const baseSorted = [...filtered].sort((a, b) => {
      if (a.avgPoints !== b.avgPoints) return a.avgPoints - b.avgPoints;
      if (a.avgPosition !== b.avgPosition) return a.avgPosition - b.avgPosition;
      if (b.tournaments !== a.tournaments) return b.tournaments - a.tournaments;
      return a.nickname.localeCompare(b.nickname);
    });
    let lastKey = "";
    let lastRank = 0;
    const withRanks = baseSorted.map((r, i) => {
      const key = `${r.avgPoints.toFixed(4)}|${r.avgPosition.toFixed(4)}|${r.tournaments}`;
      const rank = key === lastKey ? lastRank : i + 1;
      lastKey = key;
      lastRank = rank;
      return { ...r, rank };
    });
    const rankCounts = new Map<number, number>();
    for (const r of withRanks) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);
    return withRanks.map((r) => ({ ...r, tied: (rankCounts.get(r.rank) ?? 0) > 1 }));
  }, [filtered]);

  const sorted = useMemo(() => {
    const arr = [...ranked];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "rank":         arr.sort((a, b) => dir * (a.rank - b.rank)); break;
      case "team":         arr.sort((a, b) => dir * a.nickname.localeCompare(b.nickname)); break;
      case "tournaments":  arr.sort((a, b) => dir * (a.tournaments - b.tournaments)); break;
      case "avgPoints":    arr.sort((a, b) => dir * (a.avgPoints - b.avgPoints)); break;
      case "avgPosition":  arr.sort((a, b) => dir * (a.avgPosition - b.avgPosition)); break;
    }
    return arr;
  }, [ranked, sortKey, sortDir]);

  function toggleSort(k: VaultSortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  if (isLoading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>;
  if (sorted.length === 0) return (
    <div className="text-center py-12 text-slate-400 text-sm">
      {minTournaments > 0 ? `No teams with ${minTournaments}+ tournaments yet.` : "No completed tournaments yet."}
    </div>
  );

  return (
    <div className="relative max-w-3xl mx-auto px-4 md:px-12">
      {/* Minimum-tournaments filter */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Min Tournaments
        </label>
        <select
          value={minTournaments}
          onChange={(e) => setMinTournaments(Number(e.target.value))}
          className="h-8 px-2 border border-slate-200 rounded-md bg-white text-xs font-semibold"
          style={{ color: "var(--forest-deep)" }}
        >
          <option value={0}>None</option>
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={15}>15</option>
          <option value={20}>20</option>
        </select>
      </div>

      {/* Desktop sortable table */}
      <div className="hidden md:block overflow-x-auto overflow-y-visible">
        <div className="min-w-[560px]">
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-y border-slate-200">
                <SortHeader label="Rank"          k="rank"        sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-0"  widthClass="w-14" />
                <SortHeader label="Team"          k="team"        sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} sticky="left-14" widthClass="w-40" />
                <SortHeader label="Tournaments"   k="tournaments" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-24 text-center whitespace-nowrap" align="center" />
                <SortHeader label="Avg Points"    k="avgPoints"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-24 text-center whitespace-nowrap" align="center" />
                <SortHeader label="Avg Position"  k="avgPosition" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} widthClass="w-24 text-center whitespace-nowrap" align="center" />
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
                  <td className="px-2 py-3 text-center text-xs font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>
                    {r.tournaments}
                  </td>
                  <td className="px-2 py-3 text-center text-xs font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>
                    {r.avgPoints.toFixed(1)}
                  </td>
                  <td className="px-2 py-3 text-center text-xs font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>
                    {r.avgPosition.toFixed(1)}
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
          <MobilePointsCard key={r.team_id} row={r} />
        ))}
      </div>
    </div>
  );
}

function MobilePointsCard({ row }: { row: PointsRow & { rank: number; tied?: boolean } }) {
  const rankLabel = row.tied ? `T${row.rank}` : row.rank;
  const cells: Array<{ label: string; value: string }> = [
    { label: "TOURNAMENTS",  value: row.tournaments.toString() },
    { label: "AVG POINTS",   value: row.avgPoints.toFixed(1) },
    { label: "AVG POSITION", value: row.avgPosition.toFixed(1) },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      {/* Header: rank + team on left */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono font-bold text-sm tabular-nums shrink-0" style={{ color: "var(--gold)" }}>
          {rankLabel}
        </span>
        <span className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>
          {row.nickname}
        </span>
      </div>

      {/* 3-column grid: labels row, then values row */}
      <div className="grid grid-cols-3 gap-1 text-center">
        {cells.map((c) => (
          <div key={c.label} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-tight">
            {c.label}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={`${c.label}-v`}
            className="text-base font-mono font-bold tabular-nums leading-none mt-1"
            style={{ color: "var(--forest-deep)" }}
          >
            {c.value}
          </div>
        ))}
      </div>
    </div>
  );
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
                  <OomCountCell value={r.top10}   color="#475569" />
                  <OomCountCell value={r.last}    color="var(--alert,#ef4444)" />
                  <td className="px-2 py-3 text-center text-sm font-mono font-bold tabular-nums" style={{ color: r.points < 0 ? "var(--alert,#ef4444)" : "var(--forest-deep)" }}>
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
    { label: "TOP 10", value: row.top10,   color: "#475569" },
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
        <div className="text-base font-mono font-bold tabular-nums shrink-0" style={{ color: row.points < 0 ? "var(--alert,#ef4444)" : "var(--forest-deep)" }}>
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

interface TeamLite {
  id: string;
  nickname: string;
}

interface H2HScore {
  tournament_id: string;
  team_id: string;
  total_points: number;
  position_numeric: number;
}

function useTeamsList() {
  return useQuery({
    queryKey: ["h2h-teams-list"],
    queryFn: async (): Promise<TeamLite[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id,nickname")
        .order("nickname", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TeamLite[];
    },
  });
}

function useH2HData(teamAId: string | null, teamBId: string | null) {
  return useQuery({
    queryKey: ["h2h-data", teamAId, teamBId],
    enabled: !!teamAId && !!teamBId && teamAId !== teamBId,
    queryFn: async () => {
      // Fetch tournament_scores rows for both teams across all completed tournaments,
      // then intersect on tournament_id to get the head-to-head set.
      const { data: completedTours } = await supabase
        .from("tournaments")
        .select("id,name,end_date,location")
        .eq("status", "completed")
        .order("end_date", { ascending: false });
      const tours = (completedTours ?? []) as Array<{
        id: string; name: string; end_date: string; location: string | null;
      }>;
      const tourById = new Map(tours.map((t) => [t.id, t]));
      const completedIdList = tours.map((t) => t.id);
      if (completedIdList.length === 0) return { tours: [], rows: [] as Array<any> };

      // Two simple queries — one per team. Each returns at most ~15 rows so we
      // don't need the paginated fetcher for this one.
      const [{ data: a }, { data: b }] = await Promise.all([
        supabase
          .from("tournament_scores")
          .select("tournament_id,team_id,total_points,position_numeric")
          .eq("team_id", teamAId!)
          .in("tournament_id", completedIdList),
        supabase
          .from("tournament_scores")
          .select("tournament_id,team_id,total_points,position_numeric")
          .eq("team_id", teamBId!)
          .in("tournament_id", completedIdList),
      ]);
      const aById = new Map((a ?? []).map((r: any) => [r.tournament_id, r as H2HScore]));
      const bById = new Map((b ?? []).map((r: any) => [r.tournament_id, r as H2HScore]));

      // Shared tournaments: both teams have a tournament_scores row.
      const shared: Array<{
        tournament: { id: string; name: string; end_date: string; location: string | null };
        a: H2HScore;
        b: H2HScore;
      }> = [];
      for (const tid of aById.keys()) {
        const aRow = aById.get(tid);
        const bRow = bById.get(tid);
        const t = tourById.get(tid);
        if (aRow && bRow && t) shared.push({ tournament: t, a: aRow, b: bRow });
      }
      // Sorted newest-first.
      shared.sort((x, y) => y.tournament.end_date.localeCompare(x.tournament.end_date));
      return { tours, rows: shared };
    },
  });
}

function HeadToHeadView() {
  const { user } = useAuth();
  const { activeTeam } = useTeams();
  const { data: teams = [] } = useTeamsList();
  const [teamAId, setTeamAId] = useState<string | null>(null);
  const [teamBId, setTeamBId] = useState<string | null>(null);

  // Default A to active team once it loads. B starts empty.
  useMemo(() => {
    if (teamAId === null && activeTeam?.id) setTeamAId(activeTeam.id);
    return null;
  }, [teamAId, activeTeam?.id]);

  const { data, isLoading } = useH2HData(teamAId, teamBId);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamA = teamAId ? teamById.get(teamAId) : null;
  const teamB = teamBId ? teamById.get(teamBId) : null;

  const summary = useMemo(() => {
    if (!data?.rows.length) {
      return { played: 0, aWins: 0, bWins: 0, ties: 0, avgGap: 0, biggestForA: null as null | { gap: number; tName: string; year: string }, biggestForB: null as null | { gap: number; tName: string; year: string } };
    }
    let aWins = 0, bWins = 0, ties = 0;
    let sumGap = 0;
    let biggestForA: { gap: number; tName: string; year: string } | null = null;
    let biggestForB: { gap: number; tName: string; year: string } | null = null;
    for (const r of data.rows) {
      const gap = r.b.position_numeric - r.a.position_numeric; // positive means A finished better
      sumGap += gap;
      if (r.a.position_numeric < r.b.position_numeric) {
        aWins++;
        const sizeOfGap = gap;
        const year = r.tournament.end_date.slice(0, 4);
        if (!biggestForA || sizeOfGap > biggestForA.gap) {
          biggestForA = { gap: sizeOfGap, tName: r.tournament.name, year };
        }
      } else if (r.b.position_numeric < r.a.position_numeric) {
        bWins++;
        const sizeOfGap = -gap;
        const year = r.tournament.end_date.slice(0, 4);
        if (!biggestForB || sizeOfGap > biggestForB.gap) {
          biggestForB = { gap: sizeOfGap, tName: r.tournament.name, year };
        }
      } else {
        ties++;
      }
    }
    return {
      played: data.rows.length,
      aWins, bWins, ties,
      avgGap: sumGap / data.rows.length,  // positive => A averages better
      biggestForA, biggestForB,
    };
  }, [data]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-12">
      {/* Team pickers */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Team A</label>
          <select
            value={teamAId ?? ""}
            onChange={(e) => setTeamAId(e.target.value || null)}
            className="w-full h-9 px-2 border border-slate-200 rounded-md bg-white text-sm font-semibold"
            style={{ color: "var(--forest-deep)" }}
          >
            <option value="">— pick —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === teamBId}>{t.nickname}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Team B</label>
          <select
            value={teamBId ?? ""}
            onChange={(e) => setTeamBId(e.target.value || null)}
            className="w-full h-9 px-2 border border-slate-200 rounded-md bg-white text-sm font-semibold"
            style={{ color: "var(--forest-deep)" }}
          >
            <option value="">— pick —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === teamAId}>{t.nickname}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty state when one or both not chosen */}
      {(!teamA || !teamB) && (
        <div className="text-center py-12 text-slate-400 text-sm">
          Pick two different teams to compare their tournament results head-to-head.
        </div>
      )}

      {teamA && teamB && isLoading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      )}

      {teamA && teamB && !isLoading && summary.played === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          {teamA.nickname} and {teamB.nickname} haven't both entered the same completed tournament yet.
        </div>
      )}

      {teamA && teamB && !isLoading && summary.played > 0 && (
        <>
          {/* Headline: who's ahead */}
          <div className="rounded-xl overflow-hidden mb-5 shadow-sm" style={{ background: "linear-gradient(135deg, var(--forest-deep) 0%, #0a3a25 100%)" }}>
            <div className="grid grid-cols-3 text-center py-5 px-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Team A</div>
                <div className="font-display text-xl md:text-2xl text-white truncate">{teamA.nickname}</div>
                <div className="font-mono text-3xl font-bold mt-2" style={{ color: summary.aWins > summary.bWins ? "var(--gold)" : "#fff" }}>{summary.aWins}</div>
                <div className="text-[10px] uppercase tracking-widest text-white/40">wins</div>
              </div>
              <div className="flex flex-col items-center justify-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Played</div>
                <div className="font-display text-3xl text-white">{summary.played}</div>
                {summary.ties > 0 && (
                  <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">{summary.ties} tied</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Team B</div>
                <div className="font-display text-xl md:text-2xl text-white truncate">{teamB.nickname}</div>
                <div className="font-mono text-3xl font-bold mt-2" style={{ color: summary.bWins > summary.aWins ? "var(--gold)" : "#fff" }}>{summary.bWins}</div>
                <div className="text-[10px] uppercase tracking-widest text-white/40">wins</div>
              </div>
            </div>
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="border border-slate-200 rounded-md p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Avg Position Gap</div>
              <div className="font-display text-2xl mt-1" style={{ color: "var(--forest-deep)" }}>
                {Math.abs(summary.avgGap).toFixed(1)}
                <span className="text-xs font-normal text-slate-500 ml-2">
                  {summary.avgGap > 0 ? `in ${teamA.nickname}'s favour` : summary.avgGap < 0 ? `in ${teamB.nickname}'s favour` : "even"}
                </span>
              </div>
            </div>
            <div className="border border-slate-200 rounded-md p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Biggest Margin</div>
              <div className="font-display text-2xl mt-1" style={{ color: "var(--forest-deep)" }}>
                {Math.max(summary.biggestForA?.gap ?? 0, summary.biggestForB?.gap ?? 0)}
                <span className="text-xs font-normal text-slate-500 ml-2">
                  {(summary.biggestForA?.gap ?? 0) >= (summary.biggestForB?.gap ?? 0)
                    ? (summary.biggestForA ? `${teamA.nickname}, ${summary.biggestForA.tName} '${summary.biggestForA.year.slice(-2)}` : "—")
                    : (summary.biggestForB ? `${teamB.nickname}, ${summary.biggestForB.tName} '${summary.biggestForB.year.slice(-2)}` : "—")}
                </span>
              </div>
            </div>
          </div>

          {/* Match-by-match table */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 w-24">Tournament</th>
                  <th className="text-center px-3 py-2">{teamA.nickname}</th>
                  <th className="text-center px-3 py-2">{teamB.nickname}</th>
                  <th className="text-right px-3 py-2 w-16">Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data!.rows.map((r) => {
                  const aWon = r.a.position_numeric < r.b.position_numeric;
                  const bWon = r.b.position_numeric < r.a.position_numeric;
                  const gap = Math.abs(r.a.position_numeric - r.b.position_numeric);
                  return (
                    <tr key={r.tournament.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="text-xs font-semibold" style={{ color: "var(--forest-deep)" }}>
                          {r.tournament.name}
                        </div>
                        <div className="text-[10px] text-slate-500">'{r.tournament.end_date.slice(2, 4)}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="text-sm font-mono font-bold tabular-nums" style={{ color: aWon ? "var(--gold)" : "var(--forest-deep)" }}>
                          {r.a.position_numeric}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">{r.a.total_points} pts</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="text-sm font-mono font-bold tabular-nums" style={{ color: bWon ? "var(--gold)" : "var(--forest-deep)" }}>
                          {r.b.position_numeric}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">{r.b.total_points} pts</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="text-xs font-mono font-bold tabular-nums" style={{ color: aWon ? "var(--gold)" : bWon ? "var(--forest-deep)" : "#94a3b8" }}>
                          {aWon ? `+${gap}` : bWon ? `−${gap}` : "tie"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
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
            <SubChipButton
              label="Points"
              active={vaultCategory === "points"}
              onClick={() => setVaultCategory("points")}
            />
            <SubChipButton
              label="Head to Head"
              active={vaultCategory === "head_to_head"}
              onClick={() => setVaultCategory("head_to_head")}
            />
          </div>
        )}
      </div>

      {/* Sticky All Results table */}
      {view === "results" && (
      <div className="relative">
        {/* Desktop: full table with sticky Year + Tournament columns. */}
        <div className="hidden md:block overflow-x-auto overflow-y-visible">
          <div className="min-w-[760px] pr-16 md:pr-0">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-y border-slate-200">
                  <th className="sticky left-0 z-30 text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-12 bg-white">Year</th>
                  <th className="sticky left-12 z-30 text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[170px] bg-white">Tournament</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[160px] whitespace-nowrap">Location</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest w-[110px]" style={{ color: "var(--gold)" }}>1st</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 w-[110px]">2nd</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 w-[110px]">3rd</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 w-[110px]">BOTR</th>
                  <th className="text-left px-1 py-3 text-[10px] font-bold uppercase tracking-widest w-[110px]" style={{ color: "var(--alert,#ef4444)" }}>Last Place</th>
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
                    <td className="sticky left-0 z-20 px-1 py-4 text-left text-xs font-semibold tabular-nums bg-white leading-tight text-[color:var(--forest-deep)]">{r.year}</td>
                    <td className="sticky left-12 z-20 px-1 py-4 text-left text-xs font-semibold text-[color:var(--forest-deep)] whitespace-normal bg-white leading-tight">{r.name}</td>
                    <td className="px-1 py-4 text-left text-xs font-semibold text-slate-500 whitespace-nowrap leading-tight">{r.location}</td>
                    <td className="px-1 py-4"><Cell entries={r.p1} nameColor="var(--gold)" /></td>
                    <td className="px-1 py-4"><Cell entries={r.p2} /></td>
                    <td className="px-1 py-4"><Cell entries={r.p3} /></td>
                    <td className="px-1 py-4"><Cell entries={r.botr} /></td>
                    <td className="px-1 py-4"><Cell entries={r.spoon} /></td>
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
          {vaultCategory === "points" && <PointsView />}
          {vaultCategory === "head_to_head" && <HeadToHeadView />}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/hall-of-fame")({
  component: HallOfFamePage,
});
