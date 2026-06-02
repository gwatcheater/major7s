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
