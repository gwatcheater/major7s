import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, type ReactNode, type CSSProperties } from "react";
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

// Medal badge for the All Results podium. Tied positions render "T1"/"T2"/"T3"
// inside the badge; the pill widens to fit two characters.
function ResultMedal({ tier, tie }: { tier: "gold" | "silver" | "bronze"; tie: boolean }) {
  const styles: Record<string, CSSProperties> = {
    gold: { background: "radial-gradient(circle at 30% 30%, #fff7c2 0%, #f5c441 35%, #b8860b 100%)", color: "#3a2a00", boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.2)" },
    silver: { background: "radial-gradient(circle at 30% 30%, #ffffff 0%, #d3d3d3 35%, #7d7d7d 100%)", color: "#222", boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.2)" },
    bronze: { background: "radial-gradient(circle at 30% 30%, #fadcb6 0%, #c98447 35%, #6b3a1a 100%)", color: "#2a1500", boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.2)" },
  };
  const rank = tier === "gold" ? 1 : tier === "silver" ? 2 : 3;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0 h-6 text-[11px]"
      style={{ ...styles[tier], minWidth: "24px", padding: "0 6px" }}
    >
      {tie ? `T${rank}` : rank}
    </span>
  );
}

// One tournament's full result set, in the V2 podium-led layout. Forest-green
// meta panel (year / tournament / location) anchors the left; podium with medal
// badges on the right, with BOTR and Last Place demoted to a quiet footer.
// Fully responsive: the meta panel sits on top on narrow screens, beside on wider.
function ResultCard({ row }: { row: AggRow }) {
  const podium: Array<{ tier: "gold" | "silver" | "bronze"; entries: CellEntry[] }> = [
    { tier: "gold", entries: row.p1 },
    { tier: "silver", entries: row.p2 },
    { tier: "bronze", entries: row.p3 },
  ];
  const hasBotr = row.botr.length > 0;
  const hasSpoon = row.spoon.length > 0;
  const fmtFoot = (entries: CellEntry[]) => {
    const names = entries.map((e) => e.nickname).join(" / ");
    const pts = entries[0]?.points;
    return pts != null ? `${names} · ${pts}` : names;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 sm:grid-cols-[210px_1fr]">
      {/* Meta panel */}
      <div className="px-4 py-3 flex flex-col justify-center" style={{ backgroundColor: "var(--forest-deep)" }}>
        <div className="text-[10px] font-bold tracking-widest tabular-nums" style={{ color: "var(--gold)" }}>{row.year}</div>
        <div className="text-[13px] font-semibold text-white leading-tight mt-0.5 sm:whitespace-nowrap">{row.name}</div>
        {row.location && (
          <div className="text-[10px] mt-1 leading-snug sm:whitespace-nowrap sm:overflow-hidden sm:text-ellipsis" style={{ color: "#7aab8a" }}>{row.location}</div>
        )}
      </div>

      {/* Results */}
      <div className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          {podium.map(({ tier, entries }) =>
            entries.length === 0 ? null : (
              <div key={tier} className="flex items-start gap-2.5">
                <ResultMedal tier={tier} tie={entries.length > 1} />
                <div className="flex-1 min-w-0">
                  {entries.map((e, i) => (
                    <div key={i} className="text-xs font-semibold leading-snug" style={{ color: "var(--forest-deep)" }}>{e.nickname}</div>
                  ))}
                </div>
                {entries[0]?.points != null && (
                  <div className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0 pt-0.5">{entries[0].points} pts</div>
                )}
              </div>
            ),
          )}
        </div>

        {(hasBotr || hasSpoon) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 pt-2 border-t border-slate-100">
            {hasBotr && (
              <div className="text-[10px]">
                <span className="font-bold uppercase tracking-wider text-slate-400 mr-1.5 text-[9px]">botr</span>
                <span className="font-semibold" style={{ color: "var(--forest-deep)" }}>{fmtFoot(row.botr)}</span>
              </div>
            )}
            {hasSpoon && (
              <div className="text-[10px]">
                <span className="font-bold uppercase tracking-wider text-slate-400 mr-1.5 text-[9px]">last</span>
                <span className="font-semibold" style={{ color: "#791f1f" }}>{fmtFoot(row.spoon)}</span>
              </div>
            )}
          </div>
        )}
      </div>
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
  position_display: string | null;
  thru_cut: number | null;
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

// Short names for the four majors — DB stores the long form in tournaments.name.
const MAJOR_SHORT_H2H: Record<string, string> = {
  "Masters Tournament": "Masters",
  "PGA Championship": "PGA",
  "U.S. Open": "US Open",
  "The Open Championship": "The Open",
};

interface H2HFixture {
  tournament: { id: string; name: string; shortName: string; start_date: string; end_date: string };
  a: H2HScore;
  b: H2HScore;
  aSpoon: boolean;
  bSpoon: boolean;
}

function useH2HData(teamAId: string | null, teamBId: string | null) {
  return useQuery({
    queryKey: ["h2h-data", teamAId, teamBId],
    enabled: !!teamAId && !!teamBId && teamAId !== teamBId,
    queryFn: async (): Promise<{ rows: H2HFixture[] }> => {
      const { data: completedTours } = await supabase
        .from("tournaments")
        .select("id,name,start_date,end_date")
        .eq("status", "completed")
        .order("start_date", { ascending: false });
      const tours = (completedTours ?? []) as Array<{
        id: string; name: string; start_date: string; end_date: string;
      }>;
      const tourById = new Map(tours.map((t) => [t.id, t]));
      const completedIdList = tours.map((t) => t.id);
      if (completedIdList.length === 0) return { rows: [] };

      const [{ data: a }, { data: b }, { data: spoons }] = await Promise.all([
        supabase
          .from("tournament_scores")
          .select("tournament_id,team_id,total_points,position_numeric,position_display,thru_cut")
          .eq("team_id", teamAId!)
          .in("tournament_id", completedIdList),
        supabase
          .from("tournament_scores")
          .select("tournament_id,team_id,total_points,position_numeric,position_display,thru_cut")
          .eq("team_id", teamBId!)
          .in("tournament_id", completedIdList),
        // Last-place finishes — same source the OOM view uses (tournament_results
        // rows flagged result_type = 'wooden_spoon'), scoped to both teams.
        supabase
          .from("tournament_results")
          .select("tournament_id,team_id,result_type")
          .eq("result_type", "wooden_spoon")
          .in("team_id", [teamAId!, teamBId!])
          .in("tournament_id", completedIdList),
      ]);
      const aById = new Map((a ?? []).map((r: any) => [r.tournament_id, r as H2HScore]));
      const bById = new Map((b ?? []).map((r: any) => [r.tournament_id, r as H2HScore]));
      const spoonSet = new Set(
        (spoons ?? []).map((r: any) => `${r.tournament_id}:${r.team_id}`)
      );

      const rows: H2HFixture[] = [];
      for (const tid of aById.keys()) {
        const aRow = aById.get(tid);
        const bRow = bById.get(tid);
        const t = tourById.get(tid);
        if (aRow && bRow && t) {
          rows.push({
            tournament: {
              id: t.id,
              name: t.name,
              shortName: MAJOR_SHORT_H2H[t.name] ?? t.name,
              start_date: t.start_date,
              end_date: t.end_date,
            },
            a: aRow,
            b: bRow,
            aSpoon: spoonSet.has(`${tid}:${teamAId}`),
            bSpoon: spoonSet.has(`${tid}:${teamBId}`),
          });
        }
      }
      rows.sort((x, y) => y.tournament.start_date.localeCompare(x.tournament.start_date));
      return { rows };
    },
  });
}

// ---- Dominance index ---------------------------------------------------------
// Two share-based components (sum to ~100 across the pair) minus a capped shame
// penalty. Lower points are better, so the points share rewards the LOWER scorer.
// Ceiling rewards achievement points (1st=10, top3=5, top5=3, top10=1).
interface DominanceResult {
  a: number;
  b: number;
}
function computeDominance(rows: H2HFixture[]): DominanceResult {
  if (rows.length === 0) return { a: 0, b: 0 };
  let aPts = 0, bPts = 0, aAch = 0, bAch = 0, aLast = 0, bLast = 0;
  const achPoints = (pos: number) =>
    pos === 1 ? 10 : pos <= 3 ? 5 : pos <= 5 ? 3 : pos <= 10 ? 1 : 0;
  for (const r of rows) {
    aPts += r.a.total_points;
    bPts += r.b.total_points;
    aAch += achPoints(r.a.position_numeric);
    bAch += achPoints(r.b.position_numeric);
    // Last-place finishes drive the shame penalty (sourced from the OOM
    // wooden_spoon rows and attached to each fixture as aSpoon / bSpoon).
    if (r.aSpoon) aLast++;
    if (r.bSpoon) bLast++;
  }
  const avgAPts = aPts / rows.length;
  const avgBPts = bPts / rows.length;

  const ptsDenom = avgAPts + avgBPts;
  const aPtsShare = ptsDenom === 0 ? 50 : (avgBPts / ptsDenom) * 100;
  const bPtsShare = ptsDenom === 0 ? 50 : (avgAPts / ptsDenom) * 100;

  const achDenom = aAch + bAch;
  const aCeil = achDenom === 0 ? 0 : (aAch / achDenom) * 100;
  const bCeil = achDenom === 0 ? 0 : (bAch / achDenom) * 100;

  const aShame = Math.min(15, aLast * 5);
  const bShame = Math.min(15, bLast * 5);

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const aDI = clamp(0.6 * aPtsShare + 0.4 * aCeil - aShame);
  const bDI = clamp(0.6 * bPtsShare + 0.4 * bCeil - bShame);
  return { a: Math.round(aDI * 10) / 10, b: Math.round(bDI * 10) / 10 };
}

// Shared visual helpers for the comparison rows -------------------------------
const WIN_BG = "#e8f7ee";
const WIN_FG = "#1a7a45";
const LOSE_FG = "#64748b";
const MUTED_BG = "var(--surface-muted,#f1f5f9)";

function CompareRow({
  label, aWin, bWin, aContent, bContent, aTint, bTint, dividerBelow, leftAlign,
}: {
  label: ReactNode;
  aWin: boolean;
  bWin: boolean;
  aContent: ReactNode;
  bContent: ReactNode;
  aTint?: string;
  bTint?: string;
  dividerBelow?: boolean;
  leftAlign?: boolean;
}) {
  const align = leftAlign ? "items-start text-left" : "items-center text-center";
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_68px_minmax(0,1fr)] gap-1.5 items-stretch"
      style={dividerBelow ? { paddingBottom: 10, borderBottom: "0.5px solid #e2e8f0" } : undefined}
    >
      <div
        className={`rounded-lg px-2.5 py-2.5 flex flex-col justify-center ${align}`}
        style={{ backgroundColor: aTint ?? (aWin ? WIN_BG : MUTED_BG) }}
      >
        {aContent}
      </div>
      <div className="flex flex-col items-center justify-center text-center text-[11px] leading-tight text-slate-500">
        {label}
      </div>
      <div
        className={`rounded-lg px-2.5 py-2.5 flex flex-col justify-center ${align}`}
        style={{ backgroundColor: bTint ?? (bWin ? WIN_BG : MUTED_BG) }}
      >
        {bContent}
      </div>
    </div>
  );
}

function CompareVal({ children, win }: { children: ReactNode; win: boolean }) {
  return (
    <div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: win ? WIN_FG : LOSE_FG }}>
      {children}
    </div>
  );
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {title}
      </div>
      <div className="p-3.5 space-y-2.5">{children}</div>
    </div>
  );
}

// Podium medal styling (shared handover spec). Positions 1/2/3 render as a
// gold/silver/bronze badge; everything else falls back to plain mono text.
function medalFor(positionNumeric: number): "gold" | "silver" | "bronze" | null {
  if (positionNumeric === 1) return "gold";
  if (positionNumeric === 2) return "silver";
  if (positionNumeric === 3) return "bronze";
  return null;
}

function PositionMedal({
  positionDisplay, medal, size = "sm",
}: { positionDisplay: string; medal: "gold" | "silver" | "bronze" | null; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  if (!medal) {
    return <span className="font-mono text-base font-bold tabular-nums">{positionDisplay}</span>;
  }
  const styles: Record<string, CSSProperties> = {
    gold: {
      background: "radial-gradient(circle at 30% 30%, #fff7c2 0%, #f5c441 35%, #b8860b 100%)",
      color: "#3a2a00",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
    silver: {
      background: "radial-gradient(circle at 30% 30%, #ffffff 0%, #d3d3d3 35%, #7d7d7d 100%)",
      color: "#222",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
    bronze: {
      background: "radial-gradient(circle at 30% 30%, #fadcb6 0%, #c98447 35%, #6b3a1a 100%)",
      color: "#2a1500",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.25)",
    },
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold leading-none ${dim}`}
      style={styles[medal]}
    >
      {positionDisplay}
    </span>
  );
}

function HeadToHeadView() {
  const { activeTeam } = useTeams();
  const { data: teams = [] } = useTeamsList();
  const [teamAId, setTeamAId] = useState<string | null>(null);
  const [teamBId, setTeamBId] = useState<string | null>(null);

  useMemo(() => {
    if (teamAId === null && activeTeam?.id) setTeamAId(activeTeam.id);
    return null;
  }, [teamAId, activeTeam?.id]);

  const { data, isLoading } = useH2HData(teamAId, teamBId);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamA = teamAId ? teamById.get(teamAId) : null;
  const teamB = teamBId ? teamById.get(teamBId) : null;

  const rows = data?.rows ?? [];

  // ---- Aggregate everything the five sections need --------------------------
  const stats = useMemo(() => {
    const MAJOR_ORDER = ["Masters Tournament", "PGA Championship", "U.S. Open", "The Open Championship"] as const;
    const blank = {
      played: 0, aWins: 0, bWins: 0, ties: 0,
      aWinPct: 0, bWinPct: 0,
      avgPtsDeltaA: 0, avgPtsDeltaB: 0,
      avgPosDeltaA: 0, avgPosDeltaB: 0,
      biggestA: null as null | { gap: number; label: string },
      biggestB: null as null | { gap: number; label: string },
      biggestPosA: null as null | { gap: number; label: string },
      biggestPosB: null as null | { gap: number; label: string },
      slamA: 0, slamB: 0,
      firstsA: 0, firstsB: 0, top3A: 0, top3B: 0, top5A: 0, top5B: 0, top10A: 0, top10B: 0,
      eliteA: 0, eliteB: 0,
      bestByMajor: [] as Array<{ major: string; aNum: number | null; aDisp: string; bNum: number | null; bDisp: string }>,
      missedCutA: 0, missedCutB: 0, over5A: 0, over5B: 0, spoonA: 0, spoonB: 0,
      di: { a: 0, b: 0 },
    };
    if (rows.length === 0) return blank;

    let aWins = 0, bWins = 0, ties = 0;
    let sumPtsA = 0, sumPtsB = 0, sumPosA = 0, sumPosB = 0;
    let firstsA = 0, firstsB = 0, top3A = 0, top3B = 0, top5A = 0, top5B = 0, top10A = 0, top10B = 0;
    let biggestA: { gap: number; label: string } | null = null;
    let biggestB: { gap: number; label: string } | null = null;
    let biggestPosA: { gap: number; label: string } | null = null;
    let biggestPosB: { gap: number; label: string } | null = null;
    const winsByMajorA = new Set<string>();
    const winsByMajorB = new Set<string>();
    const bestA: Record<string, { num: number; disp: string } | null> = {};
    const bestB: Record<string, { num: number; disp: string } | null> = {};
    for (const m of MAJOR_ORDER) { bestA[m] = null; bestB[m] = null; }

    // Danger-stat accumulators.
    let cutFracSumA = 0, cutFracSumB = 0;   // sum of (7 - thru_cut)/7 per event
    let over5CountA = 0, over5CountB = 0;    // events with thru_cut in {5,6,7}
    let spoonA = 0, spoonB = 0;              // wooden-spoon (last place) finishes

    for (const r of rows) {
      const aN = r.a.position_numeric, bN = r.b.position_numeric;
      const aDisp = r.a.position_display ?? String(aN);
      const bDisp = r.b.position_display ?? String(bN);
      const yr = `'${(r.tournament.start_date ?? r.tournament.end_date).slice(2, 4)}`;
      const fixtureLabel = `${r.tournament.shortName} ${yr}`;

      sumPtsA += r.a.total_points; sumPtsB += r.b.total_points;
      sumPosA += aN; sumPosB += bN;

      if (aN < bN) {
        aWins++;
        const gap = r.b.total_points - r.a.total_points;
        if (!biggestA || gap > biggestA.gap) biggestA = { gap, label: fixtureLabel };
        const posGap = bN - aN;
        if (!biggestPosA || posGap > biggestPosA.gap) biggestPosA = { gap: posGap, label: fixtureLabel };
      } else if (bN < aN) {
        bWins++;
        const gap = r.a.total_points - r.b.total_points;
        if (!biggestB || gap > biggestB.gap) biggestB = { gap, label: fixtureLabel };
        const posGap = aN - bN;
        if (!biggestPosB || posGap > biggestPosB.gap) biggestPosB = { gap: posGap, label: fixtureLabel };
      } else ties++;

      if (aN === 1) firstsA++; if (bN === 1) firstsB++;
      if (aN <= 3) top3A++; if (bN <= 3) top3B++;
      if (aN <= 5) top5A++; if (bN <= 5) top5B++;
      if (aN <= 10) top10A++; if (bN <= 10) top10B++;

      const major = r.tournament.name;
      if (MAJOR_ORDER.includes(major as any)) {
        if (aN === 1) winsByMajorA.add(major);
        if (bN === 1) winsByMajorB.add(major);
        if (!bestA[major] || aN < bestA[major]!.num) bestA[major] = { num: aN, disp: aDisp };
        if (!bestB[major] || bN < bestB[major]!.num) bestB[major] = { num: bN, disp: bDisp };
      }

      // Cut-survival metrics. thru_cut = golfers through the midway cut (max 7).
      // Coerce explicitly — PostgREST can serialise integers as strings, which
      // would break the >= comparison below.
      const aThru = Number(r.a.thru_cut ?? 0);
      const bThru = Number(r.b.thru_cut ?? 0);
      cutFracSumA += (7 - aThru) / 7;
      cutFracSumB += (7 - bThru) / 7;
      if (aThru >= 5) over5CountA++;
      if (bThru >= 5) over5CountB++;
      if (r.aSpoon) spoonA++;
      if (r.bSpoon) spoonB++;
    }

    const n = rows.length;
    const avgPosA = sumPosA / n, avgPosB = sumPosB / n;
    const avgPtsA = sumPtsA / n, avgPtsB = sumPtsB / n;

    const bestByMajor = MAJOR_ORDER.map((major) => ({
      major: MAJOR_SHORT_H2H[major] ?? major,
      aNum: bestA[major]?.num ?? null,
      aDisp: bestA[major]?.disp ?? "—",
      bNum: bestB[major]?.num ?? null,
      bDisp: bestB[major]?.disp ?? "—",
    }));

    return {
      ...blank,
      played: n, aWins, bWins, ties,
      aWinPct: Math.round((aWins / n) * 100),
      bWinPct: Math.round((bWins / n) * 100),
      // Average points/position deltas relative to the opponent (lower is better).
      avgPtsDeltaA: Math.round((avgPtsA - avgPtsB) * 10) / 10,
      avgPtsDeltaB: Math.round((avgPtsB - avgPtsA) * 10) / 10,
      avgPosDeltaA: Math.round((avgPosA - avgPosB) * 10) / 10,
      avgPosDeltaB: Math.round((avgPosB - avgPosA) * 10) / 10,
      biggestA, biggestB,
      biggestPosA, biggestPosB,
      slamA: winsByMajorA.size, slamB: winsByMajorB.size,
      firstsA, firstsB, top3A, top3B, top5A, top5B, top10A, top10B,
      eliteA: Math.round((top10A / n) * 100),
      eliteB: Math.round((top10B / n) * 100),
      bestByMajor,
      // Average per-event cut rate = mean of (7 - thru_cut)/7 across events.
      missedCutA: Math.round((cutFracSumA / n) * 100),
      missedCutB: Math.round((cutFracSumB / n) * 100),
      // % of events with 5, 6 or 7 golfers through the cut.
      over5A: Math.round((over5CountA / n) * 100),
      over5B: Math.round((over5CountB / n) * 100),
      spoonA, spoonB,
      di: computeDominance(rows),
    };
  }, [rows]);

  return (
    <div className="relative max-w-3xl mx-auto px-4 md:px-12">
      <div className="max-w-xl mx-auto">
      {/* Team pickers */}
      <div className="grid grid-cols-2 gap-3 mb-4">
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

      {(!teamA || !teamB) && (
        <div className="text-center py-12 text-slate-400 text-sm">
          Pick two different teams to compare their major results head-to-head.
        </div>
      )}

      {teamA && teamB && isLoading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      )}

      {teamA && teamB && !isLoading && stats.played === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          {teamA.nickname} and {teamB.nickname} haven't both entered the same completed major yet.
        </div>
      )}

      {teamA && teamB && !isLoading && stats.played > 0 && (
        <>
          {/* Green header card */}
          <div className="rounded-xl mb-3 p-4" style={{ backgroundColor: "#1a3a2a" }}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center text-lg font-semibold leading-tight break-words text-white">{teamA.nickname}</div>
              <div className="text-center text-lg font-semibold leading-tight break-words text-white">{teamB.nickname}</div>
            </div>
            <div className="h-px mb-3" style={{ backgroundColor: "#2e5c40" }} />
            <div className="grid grid-cols-3">
              <div className="flex flex-col items-center">
                <div className="text-3xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.aWins > stats.bWins ? "var(--gold)" : "#ffffff" }}>{stats.aWins}</div>
                <div className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "#7aab8a" }}>wins</div>
                <div className="text-xs mt-1" style={{ color: stats.aWins > stats.bWins ? "var(--gold)" : "#7aab8a" }}>{stats.aWinPct}%</div>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-3xl font-mono font-bold tabular-nums text-white leading-none">{stats.played}</div>
                <div className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "#7aab8a" }}>played</div>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-3xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.bWins > stats.aWins ? "var(--gold)" : "#ffffff" }}>{stats.bWins}</div>
                <div className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "#7aab8a" }}>wins</div>
                <div className="text-xs mt-1" style={{ color: stats.bWins > stats.aWins ? "var(--gold)" : "#7aab8a" }}>{stats.bWinPct}%</div>
              </div>
            </div>
            {(stats.avgPtsDeltaA !== 0 || stats.avgPosDeltaA !== 0) && (
              <>
                <div className="h-px my-3" style={{ backgroundColor: "#2e5c40" }} />
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: "#234436" }}>
                    {stats.avgPtsDeltaA !== 0 && (
                      <>
                        <div className="text-xl font-mono font-bold tabular-nums leading-none text-white">{Math.abs(stats.avgPtsDeltaA)}</div>
                        <div className="text-[9px] uppercase tracking-wider mt-1.5" style={{ color: "#7aab8a" }}>avg pts delta</div>
                        <div className="text-[10px] mt-0.5" style={{ color: "#9fd3b4" }}>
                          {(stats.avgPtsDeltaA < 0 ? teamA.nickname : teamB.nickname)}'s favour
                        </div>
                      </>
                    )}
                  </div>
                  <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: "#234436" }}>
                    {stats.avgPosDeltaA !== 0 && (
                      <>
                        <div className="text-xl font-mono font-bold tabular-nums leading-none text-white">{Math.abs(stats.avgPosDeltaA)}</div>
                        <div className="text-[9px] uppercase tracking-wider mt-1.5" style={{ color: "#7aab8a" }}>avg pos delta</div>
                        <div className="text-[10px] mt-0.5" style={{ color: "#9fd3b4" }}>
                          {(stats.avgPosDeltaA < 0 ? teamA.nickname : teamB.nickname)}'s favour
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Dominance index — higher is better; leader shown in gold */}
          <SectionShell title="Dominance Index">
            <div className="grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] items-center">
              <div className="text-center text-4xl font-mono font-bold tabular-nums leading-none"
                style={{ color: stats.di.a > stats.di.b ? "var(--gold)" : LOSE_FG }}>
                {stats.di.a.toFixed(1)}
              </div>
              <div className="text-center text-[10px] uppercase tracking-widest text-slate-400">index</div>
              <div className="text-center text-4xl font-mono font-bold tabular-nums leading-none"
                style={{ color: stats.di.b > stats.di.a ? "var(--gold)" : LOSE_FG }}>
                {stats.di.b.toFixed(1)}
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400 text-center mt-2">
              A head-to-head dominance rating across the majors both teams entered. It blends how well each scored, how often they finished near the top, and penalties for last-place finishes — distilled into one number. The higher score has had the upper hand.
            </p>
          </SectionShell>

          {/* Performance margins */}
          <SectionShell title="Performance Margins">
            <CompareRow
              label={<>biggest<br/>margin</>}
              aWin={(stats.biggestA?.gap ?? -1) >= (stats.biggestB?.gap ?? -1) && !!stats.biggestA}
              bWin={(stats.biggestB?.gap ?? -1) > (stats.biggestA?.gap ?? -1) && !!stats.biggestB}
              aTint={stats.biggestA ? undefined : "transparent"}
              bTint={stats.biggestB ? undefined : "transparent"}
              aContent={stats.biggestA
                ? <><CompareVal win={(stats.biggestA.gap) >= (stats.biggestB?.gap ?? -1)}>{stats.biggestA.gap} <span className="text-xs font-normal">pts</span></CompareVal><div className="text-[10px] text-slate-400 mt-1">{stats.biggestA.label}</div></>
                : null}
              bContent={stats.biggestB
                ? <><CompareVal win={(stats.biggestB.gap) > (stats.biggestA?.gap ?? -1)}>{stats.biggestB.gap} <span className="text-xs font-normal">pts</span></CompareVal><div className="text-[10px] text-slate-400 mt-1">{stats.biggestB.label}</div></>
                : null}
            />
            <CompareRow
              label={<>biggest<br/>position gap</>}
              aWin={(stats.biggestPosA?.gap ?? -1) >= (stats.biggestPosB?.gap ?? -1) && !!stats.biggestPosA}
              bWin={(stats.biggestPosB?.gap ?? -1) > (stats.biggestPosA?.gap ?? -1) && !!stats.biggestPosB}
              aTint={stats.biggestPosA ? undefined : "transparent"}
              bTint={stats.biggestPosB ? undefined : "transparent"}
              aContent={stats.biggestPosA
                ? <><CompareVal win={(stats.biggestPosA.gap) >= (stats.biggestPosB?.gap ?? -1)}>{stats.biggestPosA.gap}</CompareVal><div className="text-[10px] text-slate-400 mt-1">{stats.biggestPosA.label}</div></>
                : null}
              bContent={stats.biggestPosB
                ? <><CompareVal win={(stats.biggestPosB.gap) > (stats.biggestPosA?.gap ?? -1)}>{stats.biggestPosB.gap}</CompareVal><div className="text-[10px] text-slate-400 mt-1">{stats.biggestPosB.label}</div></>
                : null}
            />
          </SectionShell>

          {/* Finish profile */}
          <SectionShell title="Finish Profile">
            <CompareRow
              label={<>Grand<br/>Slam</>}
              aWin={stats.slamA > stats.slamB}
              bWin={stats.slamB > stats.slamA}
              dividerBelow
              aContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.slamA > 0 ? "var(--gold)" : LOSE_FG }}>{stats.slamA}<span style={{ color: "#94a3b8" }}> / 4</span></div>}
              bContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.slamB > 0 ? "var(--gold)" : LOSE_FG }}>{stats.slamB}<span style={{ color: "#94a3b8" }}> / 4</span></div>}
            />
            {([
              ["1st place", stats.firstsA, stats.firstsB],
              ["Top 3", stats.top3A, stats.top3B],
              ["Top 5", stats.top5A, stats.top5B],
              ["Top 10", stats.top10A, stats.top10B],
            ] as Array<[string, number, number]>).map(([lbl, av, bv]) => (
              <CompareRow key={lbl}
                label={lbl}
                aWin={av > bv}
                bWin={bv > av}
                aContent={<CompareVal win={av > bv}>{av}</CompareVal>}
                bContent={<CompareVal win={bv > av}>{bv}</CompareVal>}
              />
            ))}
            <CompareRow
              label={<>Elite<br/>ratio</>}
              aWin={stats.eliteA > stats.eliteB}
              bWin={stats.eliteB > stats.eliteA}
              aContent={<CompareVal win={stats.eliteA > stats.eliteB}>{stats.eliteA}%</CompareVal>}
              bContent={<CompareVal win={stats.eliteB > stats.eliteA}>{stats.eliteB}%</CompareVal>}
            />
          </SectionShell>

          {/* Best finish by major — own section, left-justified tiles */}
          <SectionShell title="Best Finish by Major">
            {stats.bestByMajor.map((m) => {
              const aBetter = m.aNum !== null && (m.bNum === null || m.aNum < m.bNum);
              const bBetter = m.bNum !== null && (m.aNum === null || m.bNum < m.aNum);
              return (
                <CompareRow key={m.major}
                  label={m.major}
                  aWin={aBetter}
                  bWin={bBetter}
                  aContent={m.aNum !== null
                    ? <PositionMedal positionDisplay={m.aDisp} medal={medalFor(m.aNum)} />
                    : <CompareVal win={false}>{m.aDisp}</CompareVal>}
                  bContent={m.bNum !== null
                    ? <PositionMedal positionDisplay={m.bDisp} medal={medalFor(m.bNum)} />
                    : <CompareVal win={false}>{m.bDisp}</CompareVal>}
                />
              );
            })}
          </SectionShell>

          {/* Danger stats */}
          <SectionShell title="Danger Stats">
            <CompareRow
              label={<>missed<br/>cut rate</>}
              aWin={stats.missedCutA < stats.missedCutB}
              bWin={stats.missedCutB < stats.missedCutA}
              aTint={stats.missedCutA < stats.missedCutB ? WIN_BG : "#fcebeb"}
              bTint={stats.missedCutB < stats.missedCutA ? WIN_BG : "#fcebeb"}
              aContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.missedCutA < stats.missedCutB ? WIN_FG : "#791f1f" }}>{stats.missedCutA}%</div>}
              bContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.missedCutB < stats.missedCutA ? WIN_FG : "#791f1f" }}>{stats.missedCutB}%</div>}
            />
            <CompareRow
              label={<>&gt;5 thru<br/>cut</>}
              aWin={stats.over5A > stats.over5B}
              bWin={stats.over5B > stats.over5A}
              aContent={<CompareVal win={stats.over5A > stats.over5B}>{stats.over5A}%</CompareVal>}
              bContent={<CompareVal win={stats.over5B > stats.over5A}>{stats.over5B}%</CompareVal>}
            />
            <CompareRow
              label={<>wooden<br/>spoons</>}
              aWin={stats.spoonA < stats.spoonB}
              bWin={stats.spoonB < stats.spoonA}
              aTint={stats.spoonA < stats.spoonB ? WIN_BG : stats.spoonA > 0 ? "#fcebeb" : MUTED_BG}
              bTint={stats.spoonB < stats.spoonA ? WIN_BG : stats.spoonB > 0 ? "#fcebeb" : MUTED_BG}
              aContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.spoonA < stats.spoonB ? WIN_FG : stats.spoonA > 0 ? "#791f1f" : LOSE_FG }}>{stats.spoonA}</div>}
              bContent={<div className="text-xl font-mono font-bold tabular-nums leading-none" style={{ color: stats.spoonB < stats.spoonA ? WIN_FG : stats.spoonB > 0 ? "#791f1f" : LOSE_FG }}>{stats.spoonB}</div>}
            />
          </SectionShell>

          {/* The Majors — every head-to-head fixture */}
          <SectionShell title="The Majors">
            {rows.map((r) => {
              const aWon = r.a.position_numeric < r.b.position_numeric;
              const bWon = r.b.position_numeric < r.a.position_numeric;
              const yr = `'${(r.tournament.start_date ?? r.tournament.end_date).slice(2, 4)}`;
              const aDisp = String(r.a.position_display ?? r.a.position_numeric);
              const bDisp = String(r.b.position_display ?? r.b.position_numeric);
              return (
                <CompareRow key={r.tournament.id}
                  label={<>{r.tournament.shortName}<br/>{yr}</>}
                  aWin={aWon}
                  bWin={bWon}
                  aContent={<><div className="inline-flex justify-center">{medalFor(r.a.position_numeric)
                    ? <PositionMedal positionDisplay={aDisp} medal={medalFor(r.a.position_numeric)} />
                    : <CompareVal win={aWon}>{aDisp}</CompareVal>}</div><div className="text-[11px] text-slate-400 tabular-nums mt-1">{r.a.total_points} pts</div></>}
                  bContent={<><div className="inline-flex justify-center">{medalFor(r.b.position_numeric)
                    ? <PositionMedal positionDisplay={bDisp} medal={medalFor(r.b.position_numeric)} />
                    : <CompareVal win={bWon}>{bDisp}</CompareVal>}</div><div className="text-[11px] text-slate-400 tabular-nums mt-1">{r.b.total_points} pts</div></>}
                />
              );
            })}
          </SectionShell>
        </>
      )}
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

      {/* All Results — unified responsive card list */}
      {view === "results" && (
        <div className="px-4 md:px-12 pt-4 pb-12">
          <div className="max-w-3xl mx-auto">
            {isLoading && (
              <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
            )}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">No results yet.</div>
            )}
            <div className="space-y-2.5">
              {data?.map((r) => <ResultCard key={r.id} row={r} />)}
            </div>
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
