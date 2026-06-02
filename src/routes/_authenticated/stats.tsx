import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";

export const Route = createFileRoute("/_authenticated/stats")({
  component: AllTimeStatsPage,
});

// =============================================================
// Types
// =============================================================
interface Team {
  id: string;
  nickname: string;
  owner_user_id: string;
}

interface Tournament {
  id: string;
  name: string;
  end_date: string;
  status: string;
  location: string | null;
}

interface ScoreRow {
  tournament_id: string;
  team_id: string;
  total_points: number;
  thru_cut: number;
  position_numeric: number;
}

interface ScorePickRow {
  tournament_score_id: string;
  bucket: number;
  golfer_name: string;
  points: number;
}

interface ResultRow {
  tournament_id: string;
  team_id: string;
  result_type: string;
  position: number;
}

const MAJOR_FILTERS: { label: string; value: string; matchName: string | null }[] = [
  { label: "All tournaments", value: "all",       matchName: null },
  { label: "Masters",         value: "masters",   matchName: "Masters Tournament" },
  { label: "PGA",             value: "pga",       matchName: "PGA Championship" },
  { label: "U.S. Open",       value: "usopen",    matchName: "U.S. Open" },
  { label: "The Open",        value: "theopen",   matchName: "The Open Championship" },
];

const SHORT_NAME_BY_FULL: Record<string, string> = {
  "Masters Tournament":      "Masters",
  "PGA Championship":        "PGA",
  "U.S. Open":               "U.S. Open",
  "The Open Championship":   "The Open",
};

// =============================================================
// Component
// =============================================================
function AllTimeStatsPage() {
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeTeam } = useTeams();
  const effectiveUserId = getEffectiveUserId(user?.id);

  // -----------------------------------------------------------
  // Reference data: all teams, all tournaments. Used for dropdowns
  // and downstream lookups.
  // -----------------------------------------------------------
  const { data: teams = [] } = useQuery({
    queryKey: ["all-teams-for-stats"],
    enabled: !!effectiveUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, nickname, owner_user_id")
        .order("nickname", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Team[];
    },
  });

  const { data: tournaments = [] } = useQuery({
    queryKey: ["all-tournaments-for-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, end_date, status, location")
        .eq("status", "completed");
      if (error) throw error;
      return (data ?? []) as Tournament[];
    },
  });

  // -----------------------------------------------------------
  // Filter state. Defaults to active team / all time / all tournaments.
  // -----------------------------------------------------------
  // null = uninitialised (will default to active team), "all" = aggregate across every team,
  // otherwise a specific team UUID.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const teamId = selectedTeamId ?? activeTeam?.id ?? null;
  const isAll = teamId === "all";
  const [year, setYear] = useState<"all" | string>("all");
  const [tournamentFilter, setTournamentFilter] = useState<string>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  // Top-level tab: team-shaped stats vs golfer-shaped stats. The four filters above
  // apply to the team tab only; the golfer tab has its own filtering.
  const [tab, setTab] = useState<"team" | "golfer">("team");

  // Available years derived from tournaments (descending). Only years that have at least
  // one tournament show up in the dropdown.
  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    for (const t of tournaments) {
      if (t.end_date) ys.add(new Date(t.end_date).getFullYear().toString());
    }
    return Array.from(ys).sort((a, b) => Number(b) - Number(a));
  }, [tournaments]);

  const availableCourses = useMemo(() => {
    const cs = new Set<string>();
    for (const t of tournaments) {
      if (t.location) cs.add(t.location);
    }
    return Array.from(cs).sort((a, b) => a.localeCompare(b));
  }, [tournaments]);

  // -----------------------------------------------------------
  // Big query — every tournament_scores row for the selected team.
  // Filtered client-side by year / tournament selection (cheap; data is small).
  // -----------------------------------------------------------
  const { data: scores = [] } = useQuery({
    queryKey: ["team-scores-all", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      let q = supabase
        .from("tournament_scores")
        .select("tournament_id, team_id, total_points, thru_cut, position_numeric");
      if (!isAll) q = q.eq("team_id", teamId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
  });

  // tournament_results rows for the selected team (for podiums + wooden spoons).
  const { data: resultRows = [] } = useQuery({
    queryKey: ["team-results-all", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      let q = supabase
        .from("tournament_results")
        .select("tournament_id, team_id, result_type, position");
      if (!isAll) q = q.eq("team_id", teamId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ResultRow[];
    },
  });

  // tournament_score_picks rows for the selected team's score rows (for golfer-level
  // aggregations: avg points by bucket, most picked golfers).
  // We need tournament_score_ids first — but tournament_score is implicit via team_id
  // and tournament_id; the picks join via tournament_score_id which we need to fetch.
  // Simpler: pull the score ids alongside scores in a separate query.
  const { data: scoreIds = [] } = useQuery({
    queryKey: ["team-score-ids", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      let q = supabase
        .from("tournament_scores")
        .select("id, tournament_id");
      if (!isAll) q = q.eq("team_id", teamId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; tournament_id: string }>;
    },
  });

  const { data: pickRows = [] } = useQuery({
    queryKey: ["team-picks-all", teamId, scoreIds.map((s) => s.id).join(",")],
    enabled: !!teamId && scoreIds.length > 0,
    queryFn: async () => {
      const ids = scoreIds.map((s) => s.id);
      const { data, error } = await supabase
        .from("tournament_score_picks")
        .select("tournament_score_id, bucket, golfer_name, points")
        .in("tournament_score_id", ids);
      if (error) throw error;
      return (data ?? []) as ScorePickRow[];
    },
  });

  // -----------------------------------------------------------
  // Apply filters (year + tournament) to identify which tournament_ids are in scope.
  // -----------------------------------------------------------
  const tournamentById = useMemo(() => {
    const m = new Map<string, Tournament>();
    for (const t of tournaments) m.set(t.id, t);
    return m;
  }, [tournaments]);

  const inScopeTournamentIds = useMemo(() => {
    const majorMatchName = MAJOR_FILTERS.find((f) => f.value === tournamentFilter)?.matchName;
    const ids = new Set<string>();
    for (const t of tournaments) {
      // year filter
      if (year !== "all") {
        const ty = new Date(t.end_date).getFullYear().toString();
        if (ty !== year) continue;
      }
      // tournament/major filter
      if (majorMatchName && t.name !== majorMatchName) continue;
      // course filter
      if (courseFilter !== "all" && t.location !== courseFilter) continue;
      ids.add(t.id);
    }
    return ids;
  }, [tournaments, year, tournamentFilter, courseFilter]);

  // -----------------------------------------------------------
  // Scores filtered by scope
  // -----------------------------------------------------------
  const scopedScores = useMemo(
    () => scores.filter((s) => inScopeTournamentIds.has(s.tournament_id)),
    [scores, inScopeTournamentIds],
  );

  const scopedResults = useMemo(
    () => resultRows.filter((r) => inScopeTournamentIds.has(r.tournament_id)),
    [resultRows, inScopeTournamentIds],
  );

  const scoreIdToTournamentId = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of scoreIds) m.set(s.id, s.tournament_id);
    return m;
  }, [scoreIds]);

  const scopedPicks = useMemo(
    () =>
      pickRows.filter((p) => {
        const tid = scoreIdToTournamentId.get(p.tournament_score_id);
        return !!tid && inScopeTournamentIds.has(tid);
      }),
    [pickRows, scoreIdToTournamentId, inScopeTournamentIds],
  );

  // -----------------------------------------------------------
  // KPIs
  // -----------------------------------------------------------
  const tournamentsPlayed = scopedScores.length;

  const podiumBreakdown = useMemo(() => {
    let gold = 0, silver = 0, bronze = 0;
    for (const r of scopedResults) {
      if (r.result_type !== "podium") continue;
      if (r.position === 1) gold++;
      else if (r.position === 2) silver++;
      else if (r.position === 3) bronze++;
    }
    return { gold, silver, bronze, total: gold + silver + bronze };
  }, [scopedResults]);

  const woodenSpoons = useMemo(
    () => scopedResults.filter((r) => r.result_type === "wooden_spoon").length,
    [scopedResults],
  );

  const avgLeaderboardPosition = useMemo(() => {
    if (scopedScores.length === 0) return null;
    const sum = scopedScores.reduce((a, s) => a + s.position_numeric, 0);
    return sum / scopedScores.length;
  }, [scopedScores]);

  const avgPoints = useMemo(() => {
    if (scopedScores.length === 0) return null;
    const sum = scopedScores.reduce((a, s) => a + s.total_points, 0);
    return sum / scopedScores.length;
  }, [scopedScores]);

  const top10Finishes = scopedScores.filter((s) => s.position_numeric <= 10).length;
  const top20Finishes = scopedScores.filter((s) => s.position_numeric <= 20).length;

  // -----------------------------------------------------------
  // Best finish in each major
  // -----------------------------------------------------------
  // Note: this section IGNORES the tournament filter so it always shows all four
  // — it's the "best per major" panel, which would be self-defeating to filter.
  // It DOES respect the year and team filters.
  const bestPerMajor = useMemo(() => {
    const out: Record<string, { position: number; year: string } | null> = {
      "Masters Tournament": null,
      "PGA Championship": null,
      "U.S. Open": null,
      "The Open Championship": null,
    };
    for (const s of scores) {
      const t = tournamentById.get(s.tournament_id);
      if (!t) continue;
      const fullName = t.name;
      if (!(fullName in out)) continue;
      // year filter
      const ty = new Date(t.end_date).getFullYear().toString();
      if (year !== "all" && ty !== year) continue;
      const existing = out[fullName];
      if (!existing || s.position_numeric < existing.position ||
          (s.position_numeric === existing.position && Number(ty) > Number(existing.year))) {
        out[fullName] = { position: s.position_numeric, year: ty };
      }
    }
    return out;
  }, [scores, tournamentById, year]);

  // -----------------------------------------------------------
  // Avg golfer points by bucket B1..B7
  // -----------------------------------------------------------
  const byBucket = useMemo(() => {
    const buckets: Record<number, { sum: number; count: number }> = {};
    for (let b = 1; b <= 7; b++) buckets[b] = { sum: 0, count: 0 };
    for (const p of scopedPicks) {
      const b = buckets[p.bucket];
      if (!b) continue;
      b.sum += p.points;
      b.count++;
    }
    return buckets;
  }, [scopedPicks]);

  // -----------------------------------------------------------
  // Most picked golfers
  // -----------------------------------------------------------
  const mostPicked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of scopedPicks) {
      counts.set(p.golfer_name, (counts.get(p.golfer_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, n]) => ({ name, picks: n }))
      .sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name));
  }, [scopedPicks]);

  const [showAllGolfers, setShowAllGolfers] = useState(false);
  const golfersToShow = showAllGolfers ? mostPicked : mostPicked.slice(0, 10);

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------
  return (
    <div className="p-4 md:p-12 max-w-6xl mx-auto">
      <header className="mt-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
          Statistics
        </p>
        <h1 className="font-display text-3xl md:text-4xl mt-1">All-Time Stats</h1>
      </header>

      {/* Tab switcher */}
      <div className="flex gap-2 mb-6">
        <TabChip label="Team Stats"   active={tab === "team"}   onClick={() => setTab("team")} />
        <TabChip label="Golfer Stats" active={tab === "golfer"} onClick={() => setTab("golfer")} />
      </div>

      {tab === "team" && (
        <>
      {/* Filter row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <FilterSelect
          label="Player"
          value={teamId ?? ""}
          onChange={(v) => setSelectedTeamId(v || null)}
        >
          <option value="all">ALL</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nickname}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Date range" value={year} onChange={(v) => setYear(v as any)}>
          <option value="all">All time</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Tournament"
          value={tournamentFilter}
          onChange={(v) => setTournamentFilter(v)}
        >
          {MAJOR_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Course"
          value={courseFilter}
          onChange={(v) => setCourseFilter(v)}
        >
          <option value="all">All courses</option>
          {availableCourses.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </FilterSelect>
      </div>

      {/* Top summary card */}
      <div className="border border-border bg-card rounded-md p-5 mb-4 grid grid-cols-3 gap-4">
        <SummaryStat label="Tournaments" value={tournamentsPlayed} />
        <PodiumStat breakdown={podiumBreakdown} />
        <SummaryStat label="Last Place" value={woodenSpoons} />
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <KpiCard
          label="Avg Leaderboard Position"
          value={avgLeaderboardPosition !== null ? avgLeaderboardPosition.toFixed(1) : "—"}
        />
        <KpiCard
          label="Avg Points Scored"
          value={avgPoints !== null ? avgPoints.toFixed(1) : "—"}
        />
        <KpiCard label="Top 10 Finishes" value={top10Finishes} />
        <KpiCard label="Top 20 Finishes" value={top20Finishes} />
      </div>

      {/* Best finish in each major */}
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Best Finish In Each Major
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(["Masters Tournament", "PGA Championship", "U.S. Open", "The Open Championship"] as const).map((full) => {
          const short = SHORT_NAME_BY_FULL[full];
          const v = bestPerMajor[full];
          return (
            <div key={full} className="border border-border bg-card rounded-md p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {short}
              </div>
              <div className="font-display text-xl mt-1">
                {v ? (
                  <>
                    <span className="font-bold">{ordinal(v.position)}</span>
                    <span className="text-muted-foreground text-sm ml-1">'{v.year.slice(-2)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Avg golfer points by bucket */}
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Avg Golfer Points By Pick Bucket
      </h2>
      <div className="border border-border bg-card rounded-md overflow-hidden mb-1">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-24">Bucket</th>
              <th className="text-right px-3 py-2">Avg Points</th>
              <th className="text-right px-3 py-2 w-24">Picks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[1, 2, 3, 4, 5, 6, 7].map((b) => {
              const { sum, count } = byBucket[b];
              const avg = count > 0 ? (sum / count).toFixed(1) : "—";
              return (
                <tr key={b}>
                  <td className="px-3 py-2 font-mono text-xs">B{b}</td>
                  <td className="px-3 py-2 text-right font-mono">{avg}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground italic mb-6">
        Includes every pick — CUT / WD / DQ count their 100-point penalty.
      </p>

      {/* Most picked golfers */}
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Most Picked Golfers
      </h2>
      <div className="border border-border bg-card rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Golfer</th>
              <th className="text-right px-3 py-2 w-24">Picks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {golfersToShow.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-xs italic text-muted-foreground">
                  No picks recorded for this selection.
                </td>
              </tr>
            ) : (
              golfersToShow.map((g) => (
                <tr key={g.name}>
                  <td className="px-3 py-2">{g.name}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{g.picks}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {mostPicked.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAllGolfers((v) => !v)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {showAllGolfers ? "Show fewer" : `Show all ${mostPicked.length} golfers`}
        </button>
      )}
        </>
      )}

      {tab === "golfer" && <GolferStatsView />}
    </div>
  );
}

// =============================================================
// Small presentational components
// =============================================================
function FilterSelect({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground block mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 border border-input rounded-md bg-background text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-3xl md:text-4xl mt-1">{value}</div>
    </div>
  );
}

function PodiumStat({ breakdown }: { breakdown: { gold: number; silver: number; bronze: number; total: number } }) {
  // Olympic-style podium: gold dominant in the middle, silver left and bronze right
  // at distinctly lower heights so the three tiers read at a glance. Each pillar shows
  // the team's count above it and a medal emoji inside.
  const goldStyle: React.CSSProperties = {
    background: "radial-gradient(circle at 30% 25%, #fff7c2 0%, #f5c441 35%, #b8860b 100%)",
  };
  const silverStyle: React.CSSProperties = {
    background: "radial-gradient(circle at 30% 25%, #ffffff 0%, #d3d3d3 35%, #7d7d7d 100%)",
  };
  const bronzeStyle: React.CSSProperties = {
    background: "radial-gradient(circle at 30% 25%, #fadcb6 0%, #c98447 35%, #6b3a1a 100%)",
  };
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Total Podiums
      </div>
      <div className="font-display text-3xl md:text-4xl mt-1 mb-2">{breakdown.total}</div>

      {/* The podium itself: three columns sharing a baseline. Bigger height gaps
          between gold/silver/bronze for clearer tier differentiation. */}
      <div className="flex items-end justify-center gap-1.5 h-[120px] mt-2">
        <PodiumPillar count={breakdown.silver} heightClass="h-[50%]" style={silverStyle} emoji="🥈" />
        <PodiumPillar count={breakdown.gold}   heightClass="h-[90%]" style={goldStyle}   emoji="🥇" />
        <PodiumPillar count={breakdown.bronze} heightClass="h-[30%]" style={bronzeStyle} emoji="🥉" />
      </div>
    </div>
  );
}

function PodiumPillar({
  count, heightClass, style, emoji,
}: {
  count: number;
  heightClass: string;
  style: React.CSSProperties;
  emoji: string;
}) {
  return (
    <div className="flex flex-col items-center justify-end w-12 md:w-14 h-full">
      {/* Count above the pillar. No icon row — the emoji inside the pillar carries the tier. */}
      <span className="text-sm font-bold font-mono leading-none mb-1">{count}</span>
      {/* The pillar itself, with a medal emoji centred inside */}
      <div
        className={`w-full ${heightClass} rounded-t-md flex items-center justify-center text-xl`}
        style={{ ...style, boxShadow: "inset 0 1px 1px rgba(255,255,255,.4), 0 1px 2px rgba(0,0,0,.15)" }}
      >
        {emoji}
      </div>
    </div>
  );
}


function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-card rounded-md p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-display text-2xl md:text-3xl mt-1">{value}</div>
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// =============================================================
// TabChip — top-level tab pill matching the gold-on-forest pattern used
// elsewhere in the app for active/inactive segmented controls.
// =============================================================
function TabChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all border ${
        active
          ? "border-transparent shadow-sm"
          : "border-slate-200 text-slate-500 hover:text-[color:var(--forest-deep)] hover:border-slate-400"
      }`}
      style={active ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
    >
      {label}
    </button>
  );
}

// =============================================================
// Per-golfer pick performance dashboard.
// Sources: tournament_score_picks joined with golfers (for golfer_name) and
// tournaments (for completed-only filter).
// =============================================================
interface GolferPickStat {
  golfer_name: string;
  picks: number;
  totalPoints: number;
  bestPoints: number;
  worstPoints: number;
  modalBucket: number;          // most-common bucket they were placed in
  avgPoints: number;             // totalPoints / picks
  vsBucketDelta: number;         // negative = beat expectation (fewer points than bucket avg)
                                 // positive = underperformed expectation
}

function useGolferStats() {
  return useQuery({
    queryKey: ["golfer-stats"],
    queryFn: async (): Promise<{ rows: GolferPickStat[]; bucketAvg: Record<number, number> }> => {
      // 1) Completed tournament IDs.
      const { data: tours } = await supabase
        .from("tournaments")
        .select("id")
        .eq("status", "completed");
      const tourList = (tours ?? []) as Array<{ id: string }>;
      if (tourList.length === 0) return { rows: [], bucketAvg: {} };

      // 2) Pull score rows for the completed tournaments to get the score-id list.
      //    Then pull all picks via the paginated fetcher (the file has its own,
      //    but stats.tsx doesn't, so inline a small loop).
      const tourIds = tourList.map((t) => t.id);
      const scoreIds: string[] = [];
      {
        let from = 0;
        const pageSize = 1000;
        for (let page = 0; page < 100; page++) {
          const { data, error } = await supabase
            .from("tournament_scores")
            .select("id")
            .in("tournament_id", tourIds)
            .range(from, from + pageSize - 1);
          if (error) throw new Error(error.message);
          const chunk = (data ?? []) as Array<{ id: string }>;
          scoreIds.push(...chunk.map((c) => c.id));
          if (chunk.length < pageSize) break;
          from += pageSize;
        }
      }
      if (scoreIds.length === 0) return { rows: [], bucketAvg: {} };

      // 3) Pull all pick rows for those scores. tournament_score_picks already
      //    carries golfer_name + bucket + points, so no join needed.
      const picks: Array<{ bucket: number; golfer_name: string; points: number }> = [];
      {
        // Paginate by chunked ids to keep the .in() list manageable.
        const chunkSize = 500;
        for (let i = 0; i < scoreIds.length; i += chunkSize) {
          const idChunk = scoreIds.slice(i, i + chunkSize);
          let from = 0;
          const pageSize = 1000;
          for (let page = 0; page < 100; page++) {
            const { data, error } = await supabase
              .from("tournament_score_picks")
              .select("bucket,golfer_name,points")
              .in("tournament_score_id", idChunk)
              .range(from, from + pageSize - 1);
            if (error) throw new Error(error.message);
            const chunk = (data ?? []) as Array<{ bucket: number; golfer_name: string; points: number }>;
            picks.push(...chunk);
            if (chunk.length < pageSize) break;
            from += pageSize;
          }
        }
      }

      // 4) Bucket averages — the baseline expectation per bucket across all picks.
      const bucketAggSum: Record<number, number> = {};
      const bucketAggCount: Record<number, number> = {};
      for (const p of picks) {
        bucketAggSum[p.bucket] = (bucketAggSum[p.bucket] ?? 0) + p.points;
        bucketAggCount[p.bucket] = (bucketAggCount[p.bucket] ?? 0) + 1;
      }
      const bucketAvg: Record<number, number> = {};
      for (const b of Object.keys(bucketAggSum)) {
        const k = Number(b);
        bucketAvg[k] = bucketAggSum[k] / bucketAggCount[k];
      }

      // 5) Per-golfer aggregations.
      interface Acc {
        picks: number;
        totalPoints: number;
        bestPoints: number;
        worstPoints: number;
        bucketCounts: Record<number, number>;
        deltaSum: number;          // sum of (pick.points - bucketAvg[pick.bucket])
      }
      const byGolfer = new Map<string, Acc>();
      for (const p of picks) {
        // Normalise nickname to trimmed canonical form
        const name = (p.golfer_name ?? "").trim();
        if (!name) continue;
        let a = byGolfer.get(name);
        if (!a) {
          a = { picks: 0, totalPoints: 0, bestPoints: Infinity, worstPoints: -Infinity, bucketCounts: {}, deltaSum: 0 };
          byGolfer.set(name, a);
        }
        a.picks++;
        a.totalPoints += p.points;
        if (p.points < a.bestPoints) a.bestPoints = p.points;
        if (p.points > a.worstPoints) a.worstPoints = p.points;
        a.bucketCounts[p.bucket] = (a.bucketCounts[p.bucket] ?? 0) + 1;
        a.deltaSum += (p.points - (bucketAvg[p.bucket] ?? 0));
      }

      const rows: GolferPickStat[] = [];
      for (const [name, a] of byGolfer) {
        // Modal bucket — most-common bucket this golfer was placed in.
        let modal = 0, modalCount = 0;
        for (const b of Object.keys(a.bucketCounts)) {
          const c = a.bucketCounts[Number(b)];
          if (c > modalCount) { modalCount = c; modal = Number(b); }
        }
        rows.push({
          golfer_name: name,
          picks: a.picks,
          totalPoints: a.totalPoints,
          bestPoints: a.bestPoints === Infinity ? 0 : a.bestPoints,
          worstPoints: a.worstPoints === -Infinity ? 0 : a.worstPoints,
          modalBucket: modal,
          avgPoints: a.totalPoints / a.picks,
          vsBucketDelta: a.deltaSum / a.picks,  // negative = beat expectation
        });
      }
      return { rows, bucketAvg };
    },
  });
}

type GolferSortKey = "name" | "picks" | "avgPoints" | "best" | "worst" | "delta";

function GolferStatsView() {
  const { data, isLoading } = useGolferStats();
  const [sortKey, setSortKey] = useState<GolferSortKey>("delta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [minPicks, setMinPicks] = useState<number>(5);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => r.picks >= minPicks);
  }, [data, minPicks]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":      arr.sort((a, b) => dir * a.golfer_name.localeCompare(b.golfer_name)); break;
      case "picks":     arr.sort((a, b) => dir * (a.picks - b.picks)); break;
      case "avgPoints": arr.sort((a, b) => dir * (a.avgPoints - b.avgPoints)); break;
      case "best":      arr.sort((a, b) => dir * (a.bestPoints - b.bestPoints)); break;
      case "worst":     arr.sort((a, b) => dir * (a.worstPoints - b.worstPoints)); break;
      case "delta":     arr.sort((a, b) => dir * (a.vsBucketDelta - b.vsBucketDelta)); break;
    }
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k: GolferSortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>;
  }
  if (!data || data.rows.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No pick data yet.</div>;
  }

  return (
    <div>
      {/* Filter row */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Min Picks
        </label>
        <select
          value={minPicks}
          onChange={(e) => setMinPicks(Number(e.target.value))}
          className="h-8 px-2 border border-slate-200 rounded-md bg-white text-xs font-semibold"
          style={{ color: "var(--forest-deep)" }}
        >
          <option value={1}>None</option>
          <option value={3}>3</option>
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
        </select>
      </div>

      {/* Lead insight: Bucket averages — small strip explaining the baseline */}
      <div className="border border-slate-200 rounded-md p-3 mb-4 bg-slate-50">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Bucket Baseline (avg points per pick)
        </div>
        <div className="grid grid-cols-7 gap-2 text-center">
          {[1,2,3,4,5,6,7].map((b) => {
            const avg = data.bucketAvg[b];
            return (
              <div key={b}>
                <div className="text-[10px] text-slate-500">B{b}</div>
                <div className="text-sm font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>
                  {avg != null ? avg.toFixed(1) : "—"}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-500 italic mt-2">
          A negative "vs bucket" means the golfer scored fewer points than the average pick at their bucket level — i.e. they outperformed expectation.
        </p>
      </div>

      {/* Sortable table */}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
            <tr>
              <GolferSortHeader label="Golfer"      k="name"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
              <GolferSortHeader label="Picks"       k="picks"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Avg Points"  k="avgPoints" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Best"        k="best"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Worst"       k="worst"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="vs Bucket"   k="delta"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-slate-400 text-xs italic">No golfers with {minPicks}+ picks.</td></tr>
            ) : sorted.map((r) => (
              <tr key={r.golfer_name} className="hover:bg-slate-50">
                <td className="px-3 py-2 text-left">
                  <div className="text-xs font-semibold" style={{ color: "var(--forest-deep)" }}>{r.golfer_name}</div>
                  <div className="text-[10px] text-slate-500">Mostly B{r.modalBucket}</div>
                </td>
                <td className="px-3 py-2 text-center font-mono font-bold tabular-nums text-xs" style={{ color: "var(--forest-deep)" }}>{r.picks}</td>
                <td className="px-3 py-2 text-center font-mono font-bold tabular-nums text-xs" style={{ color: "var(--forest-deep)" }}>{r.avgPoints.toFixed(1)}</td>
                <td className="px-3 py-2 text-center font-mono tabular-nums text-xs text-slate-600">{r.bestPoints}</td>
                <td className="px-3 py-2 text-center font-mono tabular-nums text-xs text-slate-600">{r.worstPoints}</td>
                <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-xs" style={{ color: r.vsBucketDelta < 0 ? "var(--gold)" : r.vsBucketDelta > 0 ? "var(--alert,#ef4444)" : "var(--forest-deep)" }}>
                  {r.vsBucketDelta > 0 ? "+" : ""}{r.vsBucketDelta.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GolferSortHeader({
  label, k, sortKey, sortDir, onClick, align,
}: {
  label: string;
  k: GolferSortKey;
  sortKey: GolferSortKey;
  sortDir: "asc" | "desc";
  onClick: (k: GolferSortKey) => void;
  align: "left" | "center" | "right";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`px-3 py-2 ${align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-[color:var(--forest-deep)]" : "hover:text-[color:var(--forest-deep)]"}`}
      >
        {label}
        <span className="text-[8px]">{arrow}</span>
      </button>
    </th>
  );
}

