import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

// Normalise a golfer name so case/whitespace/diacritic variants merge. ESPN
// inconsistently uses accented vs unaccented forms across imports (e.g. "Sergio
// García" vs "Sergio Garcia"), and this is the cheapest defensive fix.
function normaliseGolferName(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Title-case a golfer's name for display. Splits on whitespace AND hyphens so
// double-barrelled surnames work ("Ryder Smith-Jones" → "Ryder Smith-Jones",
// not "Ryder Smith-jones"). Single-letter tokens like initials are left
// upper-cased ("J.J." stays "J.J.").
function titleCaseGolferName(s: string): string {
  if (!s) return s;
  return s
    .split(/(\s+|-)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token === "-") return token;
      // Preserve dot-separated initials like "j.j." → "J.J."
      if (/\./.test(token)) {
        return token
          .split(".")
          .map((part) => part.length === 0 ? part : part[0].toUpperCase() + part.slice(1).toLowerCase())
          .join(".");
      }
      return token.length === 0 ? token : token[0].toUpperCase() + token.slice(1).toLowerCase();
    })
    .join("");
}
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";
import MajorsStatsTable from "@/components/MajorsStatsTable";

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
  const [tab, setTab] = useState<"team" | "golfer" | "majors">("team");

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
        <TabChip label="Team Stats"    active={tab === "team"}   onClick={() => setTab("team")} />
        <TabChip label="Golfer Stats"  active={tab === "golfer"} onClick={() => setTab("golfer")} />
        <TabChip label="Major History" active={tab === "majors"} onClick={() => setTab("majors")} />
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

      {/* Top summary card.
          Row 1: three top-level KPIs (Tournaments / Total Podiums / Last Place)
                 with matching typography and Last Place in alert red.
          Row 2: per-place counts aligned over the pillars (2 / 1 / 3).
          Row 3: the podium graphic itself.
          PodiumStat handles rows 2 + 3 internally so its alignment to the
          pillars is preserved; the top-of-card label sits in row 1 here. */}
      <div className="border border-border bg-card rounded-md p-5 mb-4">
        <div className="grid grid-cols-3 gap-4">
          <SummaryStat label="Tournaments"   value={tournamentsPlayed} />
          <SummaryStat label="Podiums" value={podiumBreakdown.total} />
          <SummaryStat label="Last Place"    value={woodenSpoons} tone="alert" />
        </div>
        <PodiumStat breakdown={podiumBreakdown} />
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
              {/* Position + year on a single baseline: same font-display family,
                  same size; year uses a muted tint of forest-deep so it reads as
                  metadata against the headline position without becoming a
                  different visual element. */}
              <div className="font-display text-xl mt-1" style={{ color: "var(--forest-deep)" }}>
                {v ? (
                  <>
                    <span className="font-bold">{ordinal(v.position)}</span>
                    <span className="font-bold opacity-50 ml-1">'{v.year.slice(-2)}</span>
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

      {tab === "majors" && <MajorsStatsTable />}
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

function SummaryStat({
  label, value, tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "alert";
}) {
  // `alert` tone is used by Last Place — both label and value render in the
  // app's alert red so the failure stat reads at a glance.
  const labelClass =
    tone === "alert"
      ? "text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
      : "text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap";
  const valueStyle =
    tone === "alert" ? { color: "var(--alert, #ef4444)" } : undefined;
  const labelStyle =
    tone === "alert" ? { color: "var(--alert, #ef4444)" } : undefined;
  return (
    <div className="text-center">
      <div className={labelClass} style={labelStyle}>{label}</div>
      <div className="font-display text-3xl md:text-4xl mt-1" style={valueStyle}>{value}</div>
    </div>
  );
}

function PodiumStat({ breakdown }: { breakdown: { gold: number; silver: number; bronze: number; total: number } }) {
  // Flat-fill pillars with SVG ribbon-medals inside. No gradients, no inset
  // shadows — clean confident solid colours with a small position label and
  // medal graphic per pillar. Counts ride above each pillar in their medal tone.
  // Heights are 100/75/55 of a 160px container so the tiers read at a glance
  // with a shared baseline.
  const pillarW = "w-14 md:w-16"; // bumped slightly to give the medal more room
  const gap = "gap-2";
  return (
    <div className="mt-8">
      <div className={`flex items-end justify-center ${gap}`}>
        <PodiumPillar
          heightClass="h-[75px]"
          fill="#909090"
          position="2ND"
          pillarW={pillarW}
          count={breakdown.silver}
          countColor="#606060"
        />
        <PodiumPillar
          heightClass="h-[100px]"
          fill="#D4A800"
          position="1ST"
          pillarW={pillarW}
          count={breakdown.gold}
          countColor="#946F00"
        />
        <PodiumPillar
          heightClass="h-[55px]"
          fill="#B87040"
          position="3RD"
          pillarW={pillarW}
          count={breakdown.bronze}
          countColor="#7E4923"
        />
      </div>
    </div>
  );
}

function PodiumPillar({
  heightClass, fill, position, pillarW, count, countColor,
}: {
  heightClass: string;
  fill: string;            // solid pillar colour (medal tone)
  position: string;        // "1ST" | "2ND" | "3RD"
  pillarW: string;
  count: number;
  countColor: string;
}) {
  // Solid-fill pillar. Internal stack:
  //   - count (above the pillar, in darker medal tone)
  //   - position label (inside, near bottom, semi-transparent white)
  // No medal graphic, no inset shadow, no gradient. Clean flat shapes.
  return (
    <div className={`flex flex-col items-center justify-end ${pillarW} h-full`}>
      <span
        className="font-display text-2xl md:text-3xl leading-none mb-1"
        style={{ color: countColor }}
      >
        {count}
      </span>
      <div
        className={`w-full ${heightClass} rounded-t-md flex items-end justify-center pb-2`}
        style={{ backgroundColor: fill }}
      >
        <span
          className="text-[11px] font-bold tracking-widest"
          style={{ color: "rgba(255,255,255,0.9)" }}
        >
          {position}
        </span>
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
  appearances: number;           // count of distinct tournaments this golfer appeared in (any team's pick)
  totalPoints: number;
  bestPoints: number;
  worstPoints: number;           // worst score excluding cuts (< 100); falls back to 100 if every pick was cut
  cuts: number;                  // count of picks that ended in a CUT/WD/DQ (== 100 points)
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
      const scoreRows: Array<{ id: string; tournament_id: string }> = [];
      {
        let from = 0;
        const pageSize = 1000;
        for (let page = 0; page < 100; page++) {
          const { data, error } = await supabase
            .from("tournament_scores")
            .select("id,tournament_id")
            .in("tournament_id", tourIds)
            .range(from, from + pageSize - 1);
          if (error) throw new Error(error.message);
          const chunk = (data ?? []) as Array<{ id: string; tournament_id: string }>;
          scoreRows.push(...chunk);
          if (chunk.length < pageSize) break;
          from += pageSize;
        }
      }
      if (scoreRows.length === 0) return { rows: [], bucketAvg: {} };
      const scoreIds = scoreRows.map((r) => r.id);
      const tournamentByScoreId = new Map(scoreRows.map((r) => [r.id, r.tournament_id]));

      // 3) Pull all pick rows for those scores. tournament_score_picks already
      //    carries golfer_name + bucket + points, so no join needed.
      //    Chunked at 100 score-ids per query (~700 picks per query, well under
      //    Supabase's 1000-row cap so no inner pagination needed).
      const picks: Array<{ tournament_score_id: string; bucket: number; golfer_name: string; points: number }> = [];
      const CHUNK = 100;
      for (let i = 0; i < scoreIds.length; i += CHUNK) {
        const idChunk = scoreIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("tournament_score_picks")
          .select("tournament_score_id,bucket,golfer_name,points")
          .in("tournament_score_id", idChunk);
        if (error) throw new Error(`picks query failed: ${error.message}`);
        picks.push(...((data ?? []) as Array<{ tournament_score_id: string; bucket: number; golfer_name: string; points: number }>));
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
        worstRealPoints: number;   // tracks worst NON-cut score (< 100); -Infinity if no non-cut picks
        cutTournaments: Set<string>;  // distinct tournaments where this golfer was cut
        bucketCounts: Record<number, number>;
        deltaSum: number;
        tournamentSet: Set<string>;
      }
      const byGolfer = new Map<string, Acc>();
      // Store display name on the Acc so we can render the original-cased value;
      // key the Map by normalised name so accent variants merge into one row.
      const displayByKey = new Map<string, string>();
      for (const p of picks) {
        const rawName = (p.golfer_name ?? "").trim();
        if (!rawName) continue;
        const nameKey = normaliseGolferName(rawName);
        if (!displayByKey.has(nameKey)) displayByKey.set(nameKey, rawName);
        let a = byGolfer.get(nameKey);
        if (!a) {
          a = { picks: 0, totalPoints: 0, bestPoints: Infinity, worstRealPoints: -Infinity, cutTournaments: new Set(), bucketCounts: {}, deltaSum: 0, tournamentSet: new Set() };
          byGolfer.set(nameKey, a);
        }
        a.picks++;
        a.totalPoints += p.points;
        if (p.points < a.bestPoints) a.bestPoints = p.points;
        // The CUT/WD/DQ penalty is exactly 100 points. Anything < 100 is a real (weekend-played)
        // finishing score. Worst (real) tracks only the real scores; CUT counts the DISTINCT
        // tournaments where this golfer was cut (not the number of teams who picked him then).
        if (p.points >= 100) {
          const cutTid = tournamentByScoreId.get(p.tournament_score_id);
          if (cutTid) a.cutTournaments.add(cutTid);
        } else if (p.points > a.worstRealPoints) {
          a.worstRealPoints = p.points;
        }
        a.bucketCounts[p.bucket] = (a.bucketCounts[p.bucket] ?? 0) + 1;
        a.deltaSum += (p.points - (bucketAvg[p.bucket] ?? 0));
        const tid = tournamentByScoreId.get(p.tournament_score_id);
        if (tid) a.tournamentSet.add(tid);
      }

      const rows: GolferPickStat[] = [];
      for (const [key, a] of byGolfer) {
        const name = titleCaseGolferName(displayByKey.get(key) ?? key);
        // Modal bucket — most-common bucket this golfer was placed in.
        let modal = 0, modalCount = 0;
        for (const b of Object.keys(a.bucketCounts)) {
          const c = a.bucketCounts[Number(b)];
          if (c > modalCount) { modalCount = c; modal = Number(b); }
        }
        rows.push({
          golfer_name: name,
          picks: a.picks,
          appearances: a.tournamentSet.size,
          totalPoints: a.totalPoints,
          bestPoints: a.bestPoints === Infinity ? 0 : a.bestPoints,
          // Worst (real): if no non-cut picks exist, fall back to 100 (the cut value).
          worstPoints: a.worstRealPoints === -Infinity ? 100 : a.worstRealPoints,
          cuts: a.cutTournaments.size,
          modalBucket: modal,
          avgPoints: a.totalPoints / a.picks,
          vsBucketDelta: a.deltaSum / a.picks,
        });
      }
      return { rows, bucketAvg };
    },
  });
}

type GolferSortKey = "name" | "picks" | "appearances" | "avgPoints" | "best" | "worst" | "cuts" | "delta";

interface AllGolferStat {
  golfer_name: string;
  picks: number;                     // count of picks this golfer received across all tournaments
  appearances: number;               // distinct tournaments this golfer was in the field of
  totalPoints: number;
  bestPoints: number;
  worstPoints: number;
  cuts: number;                      // distinct tournaments cut/WD/DQ
  modalBucket: number;               // most-common bucket assignment
  avgPoints: number;
  vsBucketDelta: number;             // negative = beat expectation, positive = underperformed
}

function useAllGolferStats() {
  return useQuery({
    queryKey: ["all-golfer-stats"],
    queryFn: async (): Promise<{ rows: AllGolferStat[]; bucketAvg: Record<number, number> }> => {
      // 1) Completed tournaments.
      const { data: tours } = await supabase
        .from("tournaments").select("id").eq("status", "completed");
      const tourIds = ((tours ?? []) as Array<{ id: string }>).map((t) => t.id);
      if (tourIds.length === 0) return { rows: [], bucketAvg: {} };

      // 2) Paginated fetch of golfers (one row per golfer per tournament with bucket assignment).
      //    Schema: golfers.tournament_id + golfers.golfer_name + golfers.bucket_number.
      interface GolferRow { id: string; tournament_id: string; golfer_name: string; bucket_number: number | null; }
      const golfers: GolferRow[] = [];
      {
        let from = 0; const pageSize = 1000;
        for (let page = 0; page < 100; page++) {
          const { data, error } = await supabase
            .from("golfers")
            .select("id,tournament_id,golfer_name,bucket_number")
            .in("tournament_id", tourIds)
            .range(from, from + pageSize - 1);
          if (error) throw new Error(`golfers query failed: ${error.message}`);
          const chunk = (data ?? []) as GolferRow[];
          golfers.push(...chunk);
          if (chunk.length < pageSize) break;
          from += pageSize;
        }
      }

      // 3) Paginated fetch of leaderboard rows for completed tournaments.
      interface LbRow { tournament_id: string; golfer_id: string | null; position_numeric: number | null; status_type: string | null; }
      const lb: LbRow[] = [];
      {
        let from = 0; const pageSize = 1000;
        for (let page = 0; page < 100; page++) {
          const { data, error } = await supabase
            .from("tournament_leaderboard")
            .select("tournament_id,golfer_id,position_numeric,status_type")
            .in("tournament_id", tourIds)
            .range(from, from + pageSize - 1);
          if (error) throw new Error(`leaderboard query failed: ${error.message}`);
          const chunk = (data ?? []) as LbRow[];
          lb.push(...chunk);
          if (chunk.length < pageSize) break;
          from += pageSize;
        }
      }

      // 4) Paginated fetch of picks — used to populate the "Picks" column.
      //    Picks rows count how many teams picked each golfer.
      interface PickRow { golfer_id: string; }
      const picks: PickRow[] = [];
      {
        let from = 0; const pageSize = 1000;
        for (let page = 0; page < 100; page++) {
          const { data, error } = await supabase
            .from("picks")
            .select("golfer_id,tournament_id")
            .in("tournament_id", tourIds)
            .range(from, from + pageSize - 1);
          if (error) throw new Error(`picks query failed: ${error.message}`);
          const chunk = (data ?? []) as PickRow[];
          picks.push(...chunk);
          if (chunk.length < pageSize) break;
          from += pageSize;
        }
      }
      const pickCountByGolferId = new Map<string, number>();
      for (const p of picks) pickCountByGolferId.set(p.golfer_id, (pickCountByGolferId.get(p.golfer_id) ?? 0) + 1);

      // 5) Build a (tournament_id, golfer_id) -> { points, bucket, name } map.
      //    Major7s scoring: position_numeric for completers, 100 for CUT/WD/DQ.
      function isCut(s: string | null): boolean {
        return s === "STATUS_CUT" || s === "STATUS_WITHDRAWN" || s === "STATUS_DISQUALIFIED";
      }
      // Index the leaderboard by (tournament_id, golfer_id).
      const lbByKey = new Map<string, LbRow>();
      for (const r of lb) {
        if (!r.golfer_id) continue;
        lbByKey.set(`${r.tournament_id}::${r.golfer_id}`, r);
      }

      // 6) Aggregate per golfer_name (since the same golfer appears under different
      //    UUIDs across tournaments — we key by name to merge tournaments).
      interface Acc {
        name: string;
        bucketCounts: Record<number, number>;
        appearances: Set<string>;
        cuts: Set<string>;
        totalPoints: number;
        scoredCount: number;
        best: number;
        worst: number;                   // includes CUT 100s — kept for completeness
        worstReal: number;               // worst non-CUT (< 100); -Infinity if every score was a CUT
        deltaSum: number;
        deltaCount: number;
        picksTotal: number;
      }
      const byName = new Map<string, Acc>();
      const bucketSum: Record<number, number> = {};
      const bucketCount: Record<number, number> = {};

      for (const g of golfers) {
        const rawName = (g.golfer_name ?? "").trim();
        if (!rawName) continue;
        const nameKey = normaliseGolferName(rawName);
        const lbRow = lbByKey.get(`${g.tournament_id}::${g.id}`);
        let a = byName.get(nameKey);
        if (!a) {
          a = {
            name: rawName,
            bucketCounts: {},
            appearances: new Set(),
            cuts: new Set(),
            totalPoints: 0,
            scoredCount: 0,
            best: Infinity,
            worst: -Infinity,
            worstReal: -Infinity,
            deltaSum: 0,
            deltaCount: 0,
            picksTotal: pickCountByGolferId.get(g.id) ?? 0,
          };
          byName.set(nameKey, a);
        } else {
          a.picksTotal += pickCountByGolferId.get(g.id) ?? 0;
        }
        a.appearances.add(g.tournament_id);
        if (g.bucket_number != null) {
          a.bucketCounts[g.bucket_number] = (a.bucketCounts[g.bucket_number] ?? 0) + 1;
        }

        if (lbRow) {
          const isCutFlag = isCut(lbRow.status_type);
          // Major7s scoring rule.
          const points = isCutFlag ? 100 : (lbRow.position_numeric ?? 100);
          a.totalPoints += points;
          a.scoredCount += 1;
          if (points < a.best) a.best = points;
          if (points > a.worst) a.worst = points;
          // Worst NON-cut: filter out the 100 penalty so this reflects floor
          // performance when the golfer actually played the weekend.
          if (!isCutFlag && points > a.worstReal) a.worstReal = points;
          if (isCutFlag) a.cuts.add(g.tournament_id);

          // Contribute to global bucket average.
          if (g.bucket_number != null) {
            bucketSum[g.bucket_number] = (bucketSum[g.bucket_number] ?? 0) + points;
            bucketCount[g.bucket_number] = (bucketCount[g.bucket_number] ?? 0) + 1;
          }
        }
      }

      // Bucket averages (ALL mode baseline).
      const bucketAvg: Record<number, number> = {};
      for (const b of Object.keys(bucketSum)) {
        const k = Number(b);
        bucketAvg[k] = bucketSum[k] / bucketCount[k];
      }

      // Second pass: compute per-golfer delta vs their bucket-assigned baseline.
      for (const g of golfers) {
        const rawName = (g.golfer_name ?? "").trim();
        if (!rawName) continue;
        const a = byName.get(normaliseGolferName(rawName));
        if (!a) continue;
        const lbRow = lbByKey.get(`${g.tournament_id}::${g.id}`);
        if (!lbRow) continue;
        const isCutFlag = isCut(lbRow.status_type);
        const points = isCutFlag ? 100 : (lbRow.position_numeric ?? 100);
        if (g.bucket_number != null && bucketAvg[g.bucket_number] != null) {
          a.deltaSum += (points - bucketAvg[g.bucket_number]);
          a.deltaCount += 1;
        }
      }

      // Build final rows.
      const rows: AllGolferStat[] = [];
      for (const [, a] of byName) {
        let modal = 0, modalCount = 0;
        for (const b of Object.keys(a.bucketCounts)) {
          const c = a.bucketCounts[Number(b)];
          if (c > modalCount) { modalCount = c; modal = Number(b); }
        }
        rows.push({
          // Display name is the original-cased rawName stored on the Acc;
          // the Map key is the normalised lowercased form we don't want to render.
          golfer_name: titleCaseGolferName(a.name),
          picks: a.picksTotal,
          appearances: a.appearances.size,
          totalPoints: a.totalPoints,
          bestPoints: a.best === Infinity ? 0 : a.best,
          // Worst displays non-CUT floor — falls back to 100 only if every pick
          // was a CUT (matches PICKED mode and the rule we agreed on).
          worstPoints: a.worstReal === -Infinity ? 100 : a.worstReal,
          cuts: a.cuts.size,
          modalBucket: modal,
          avgPoints: a.scoredCount > 0 ? a.totalPoints / a.scoredCount : 0,
          vsBucketDelta: a.deltaCount > 0 ? a.deltaSum / a.deltaCount : 0,
        });
      }
      return { rows, bucketAvg };
    },
  });
}

function GolferStatsView() {
  // Mode toggle: ALL by default (every golfer who has appeared in any completed
  // tournament field, scored via Major7s rules from the leaderboard); PICKED
  // restricts to only the golfers our community has actually picked.
  const [mode, setMode] = useState<"all" | "picked">("all");
  const pickedQuery = useGolferStats();
  const allQuery = useAllGolferStats();
  const isLoading = mode === "all" ? allQuery.isLoading : pickedQuery.isLoading;
  const error = mode === "all" ? allQuery.error : pickedQuery.error;
  // Both modes return the same row shape (golfer_name, picks, appearances,
  // totalPoints, bestPoints, worstPoints, cuts, modalBucket, avgPoints,
  // vsBucketDelta), so a single typed view layer below handles both.
  const data = mode === "all" ? allQuery.data : pickedQuery.data;

  const [sortKey, setSortKey] = useState<GolferSortKey>("delta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [minPicks, setMinPicks] = useState<number>(5);
  const [minAppearances, setMinAppearances] = useState<number>(1);
  // Search filter — free-text substring match on golfer name.
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = normaliseGolferName(searchQuery);
    const matchesSearch = (name: string) =>
      q.length === 0 || normaliseGolferName(name).includes(q);
    if (mode === "all") {
      return data.rows.filter((r) => r.appearances >= minAppearances && matchesSearch(r.golfer_name));
    }
    return data.rows.filter((r) => r.picks >= minPicks && matchesSearch(r.golfer_name));
  }, [data, minPicks, minAppearances, mode, searchQuery]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":         arr.sort((a, b) => dir * a.golfer_name.localeCompare(b.golfer_name)); break;
      case "picks":        arr.sort((a, b) => dir * (a.picks - b.picks)); break;
      case "appearances":  arr.sort((a, b) => dir * (a.appearances - b.appearances)); break;
      case "avgPoints":    arr.sort((a, b) => dir * (a.avgPoints - b.avgPoints)); break;
      case "best":         arr.sort((a, b) => dir * (a.bestPoints - b.bestPoints)); break;
      case "worst":        arr.sort((a, b) => dir * (a.worstPoints - b.worstPoints)); break;
      case "cuts":         arr.sort((a, b) => dir * (a.cuts - b.cuts)); break;
      case "delta":        arr.sort((a, b) => dir * (a.vsBucketDelta - b.vsBucketDelta)); break;
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
  if (error) {
    return (
      <div className="text-center py-12 text-sm">
        <div className="text-red-600 font-semibold mb-2">Failed to load golfer stats</div>
        <div className="text-slate-500 text-xs font-mono">{(error as Error)?.message ?? String(error)}</div>
      </div>
    );
  }
  if (!data || data.rows.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No pick data yet.</div>;
  }

  return (
    <div>
      {/* Mode toggle + filter row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex rounded-full border border-slate-200 p-0.5">
          <button
            type="button"
            onClick={() => setMode("all")}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${
              mode === "all" ? "shadow-sm" : "text-slate-500 hover:text-[color:var(--forest-deep)]"
            }`}
            style={mode === "all" ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setMode("picked")}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${
              mode === "picked" ? "shadow-sm" : "text-slate-500 hover:text-[color:var(--forest-deep)]"
            }`}
            style={mode === "picked" ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
          >
            Picked
          </button>
        </div>

        {mode === "all" ? (
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Min Appearances
            </label>
            <select
              value={minAppearances}
              onChange={(e) => setMinAppearances(Number(e.target.value))}
              className="h-8 px-2 border border-slate-200 rounded-md bg-white text-xs font-semibold"
              style={{ color: "var(--forest-deep)" }}
            >
              <option value={1}>None</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={20}>20</option>
              <option value={25}>25</option>
              <option value={30}>30</option>
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
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
        )}
      </div>

      {/* Intro: explain what the table is showing */}
      <div className="mb-4 text-xs text-slate-600 leading-relaxed">
        <p>
          Every golfer ever picked across completed tournaments, aggregated across all teams that picked them.
          <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> Avg Points</span> is the average points scored when picked.
          <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> CUT</span> is the number of distinct tournaments this golfer missed the cut in (or WD/DQ).
          <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> Worst</span> is the worst non-cut finish.
          <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> vs Bucket</span> compares the golfer's actual points against the average score for picks in the same bucket — a negative value (gold) means they outperformed expectation; positive (red) means they underperformed. The bucket baseline below shows the average points per pick at each bucket level.
        </p>
      </div>

      {/* Lead insight: Bucket averages — small strip showing the baseline */}
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

      </div>

      {/* Search bar — sits between the baseline strip and the data table */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search golfers…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 px-3 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]"
          style={{ color: "var(--forest-deep)" }}
        />
      </div>

      {/* Sortable table — desktop */}
      <div className="hidden md:block border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
            <tr>
              <GolferSortHeader label="Golfer"      k="name"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
              <GolferSortHeader label="Picks"        k="picks"        sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Appearances"  k="appearances"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Avg Points"   k="avgPoints"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Best"        k="best"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="Worst"       k="worst"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="CUT"         k="cuts"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
              <GolferSortHeader label="vs Bucket"   k="delta"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-400 text-xs italic">
                {mode === "all"
                  ? `No golfers with ${minAppearances}+ appearance${minAppearances === 1 ? "" : "s"}.`
                  : `No golfers with ${minPicks}+ picks.`}
              </td></tr>
            ) : sorted.map((r) => (
              <tr key={r.golfer_name} className="hover:bg-slate-50">
                <td className="px-2 py-2 text-left">
                  <div className="text-xs font-semibold" style={{ color: "var(--forest-deep)" }}>{r.golfer_name}</div>
                  <div className="text-[10px] text-slate-500">Mostly B{r.modalBucket}</div>
                </td>
                <td className="px-2 py-2 text-center font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: "var(--forest-deep)" }}>{r.picks}</td>
                <td className="px-2 py-2 text-center font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: "var(--forest-deep)" }}>{r.appearances}</td>
                <td className="px-2 py-2 text-center font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: "var(--forest-deep)" }}>{r.avgPoints.toFixed(1)}</td>
                <td className="px-2 py-2 text-center font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">{r.bestPoints}</td>
                <td className="px-2 py-2 text-center font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">{r.worstPoints}</td>
                <td className="px-2 py-2 text-center font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: r.cuts > 0 ? "var(--alert,#ef4444)" : "var(--forest-deep)" }}>{r.cuts}</td>
                <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: r.vsBucketDelta < 0 ? "var(--gold)" : r.vsBucketDelta > 0 ? "var(--alert,#ef4444)" : "var(--forest-deep)" }}>
                  {r.vsBucketDelta > 0 ? "+" : ""}{r.vsBucketDelta.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {sorted.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs italic">
            {mode === "all"
              ? `No golfers with ${minAppearances}+ appearance${minAppearances === 1 ? "" : "s"}.`
              : `No golfers with ${minPicks}+ picks.`}
          </div>
        ) : sorted.map((r) => (
          <MobileGolferCard key={r.golfer_name} row={r} />
        ))}
      </div>
    </div>
  );
}

function MobileGolferCard({ row }: { row: GolferPickStat }) {
  // Header: name + "Mostly B?" on the left; vs Bucket delta as the headline number top-right.
  // Below: 4-column grid (PICKS / APPS / AVG / BEST) with values underneath. Worst hidden
  // on mobile to keep the grid balanced — desktop still shows it; mobile already has the
  // headline insight on the right of the header.
  const deltaColor =
    row.vsBucketDelta < 0 ? "var(--gold)" :
    row.vsBucketDelta > 0 ? "var(--alert,#ef4444)" :
    "var(--forest-deep)";
  const cells: Array<{ label: string; value: string; color?: string }> = [
    { label: "PICKS",  value: row.picks.toString() },
    { label: "APPS",   value: row.appearances.toString() },
    { label: "AVG",    value: row.avgPoints.toFixed(1) },
    { label: "CUT",    value: row.cuts.toString(), color: row.cuts > 0 ? "var(--alert,#ef4444)" : undefined },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>
            {row.golfer_name}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Mostly B{row.modalBucket}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">vs Bucket</div>
          <div className="text-lg font-mono font-bold tabular-nums leading-tight mt-0.5" style={{ color: deltaColor }}>
            {row.vsBucketDelta > 0 ? "+" : ""}{row.vsBucketDelta.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 text-center">
        {cells.map((c) => (
          <div key={c.label} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
            {c.label}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={`${c.label}-v`}
            className="text-sm font-mono font-bold tabular-nums leading-none mt-1"
            style={{ color: c.color ?? "var(--forest-deep)" }}
          >
            {c.value}
          </div>
        ))}
      </div>

      {/* Best/Worst footer strip — small, neutral, so they're available on mobile
          without crowding the main grid above. */}
      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span>
          <span className="font-bold uppercase tracking-wider text-slate-400 mr-1">Best</span>
          <span className="font-mono font-semibold tabular-nums">{row.bestPoints}</span>
        </span>
        <span>
          <span className="font-bold uppercase tracking-wider text-slate-400 mr-1">Worst</span>
          <span className="font-mono font-semibold tabular-nums">{row.worstPoints}</span>
        </span>
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
    <th className={`px-2 py-2 ${align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"} whitespace-nowrap`}>
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

