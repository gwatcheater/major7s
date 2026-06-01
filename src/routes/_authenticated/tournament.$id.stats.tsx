import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Users, Zap, Clock, Repeat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";


export const Route = createFileRoute("/_authenticated/tournament/$id/stats")({
  component: TournamentStatsPage,
});

// =============================================================
// Types — column names sourced from existing schema:
//   picks: team_id, tournament_id, bucket, golfer_id,
//          submitted_at, last_edited_at, tweak_count
//   golfers: id, golfer_name, owgr_rank, tournament_id
//   teams: id, nickname
//   tournaments: id, name, status, submission_deadline, start_date, end_date
// If your column names differ, adjust the select() strings below.
// =============================================================
interface Tournament {
  id: string;
  name: string;
  status: string;
  submission_deadline: string;
}
interface Pick {
  team_id: string;
  bucket: number;
  golfer_id: string;
  submitted_at: string;
  last_edited_at: string;
  tweak_count: number | null;
}
interface Golfer {
  id: string;
  golfer_name: string;
  owgr_rank: number | null;
}
interface Team {
  id: string;
  nickname: string;
}

const VISIBLE_STATUSES = ["picks_closed", "live", "completed"];

// =============================================================
// Helpers
// =============================================================
function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k > n || k <= 0) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

// =============================================================
// Component
// =============================================================
function TournamentStatsPage() {
  const { id } = Route.useParams();
  const [sortMode, setSortMode] = useState<"picks" | "ranking">("picks");
  const [showAll, setShowAll] = useState(false);

  const tournamentQ = useQuery({
    queryKey: ["t-stats", "tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, status, submission_deadline")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Tournament;
    },
  });

  const picksQ = useQuery({
    queryKey: ["t-stats", "picks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count")
        .eq("tournament_id", id);
      if (error) throw error;
      return (data ?? []) as Pick[];
    },
  });

  const golfersQ = useQuery({
    queryKey: ["t-stats", "golfers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name, owgr_rank")
        .eq("tournament_id", id);
      if (error) throw error;
      return (data ?? []) as Golfer[];
    },
  });

  const teamsQ = useQuery({
    queryKey: ["t-stats", "teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, nickname");
      if (error) throw error;
      return (data ?? []) as Team[];
    },
  });

  const isLoading =
    tournamentQ.isLoading || picksQ.isLoading || golfersQ.isLoading || teamsQ.isLoading;
  const error =
    tournamentQ.error || picksQ.error || golfersQ.error || teamsQ.error;

  const t = tournamentQ.data;
  const picks = picksQ.data ?? [];
  const golfers = golfersQ.data ?? [];
  const teams = teamsQ.data ?? [];

  const golferById = useMemo(
    () => new Map(golfers.map((g) => [g.id, g])),
    [golfers],
  );
  const teamById = useMemo(
    () => new Map(teams.map((tm) => [tm.id, tm])),
    [teams],
  );

  // Group picks by team
  const picksByTeam = useMemo(() => {
    const map = new Map<string, Pick[]>();
    for (const p of picks) {
      if (!map.has(p.team_id)) map.set(p.team_id, []);
      map.get(p.team_id)!.push(p);
    }
    return map;
  }, [picks]);

  // ----- Section 1: Most Popular Picks -----
  const mostPopular = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.golfer_id, (counts.get(p.golfer_id) ?? 0) + 1);
    const totalTeams = picksByTeam.size;
    const rows = Array.from(counts.entries()).map(([gid, count]) => {
      const g = golferById.get(gid);
      return {
        id: gid,
        name: g?.golfer_name ?? "Unknown",
        owgr: g?.owgr_rank ?? null,
        count,
        pct: totalTeams ? (count / totalTeams) * 100 : 0,
      };
    });
    if (sortMode === "picks") {
      rows.sort((a, b) => b.count - a.count || (a.owgr ?? 9999) - (b.owgr ?? 9999));
    } else {
      rows.sort((a, b) => (a.owgr ?? 9999) - (b.owgr ?? 9999));
    }
    return rows;
  }, [picks, golferById, picksByTeam, sortMode]);

  const topCount = mostPopular[0]?.count ?? 1;
  const visiblePopular = showAll ? mostPopular : mostPopular.slice(0, 10);

  // ----- Section 2: Unique Picks -----
  const uniquePicks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.golfer_id, (counts.get(p.golfer_id) ?? 0) + 1);
    return picks
      .filter((p) => counts.get(p.golfer_id) === 1)
      .map((p) => ({
        golfer: golferById.get(p.golfer_id)?.golfer_name ?? "Unknown",
        owgr: golferById.get(p.golfer_id)?.owgr_rank ?? null,
        team: teamById.get(p.team_id)?.nickname ?? "Unknown team",
        bucket: p.bucket,
      }))
      .sort((a, b) => a.bucket - b.bucket || a.golfer.localeCompare(b.golfer));
  }, [picks, golferById, teamById]);

  // ----- Section 3: Popular Combinations -----
  const comboSections = useMemo(() => {
    const teamGolferLists: { teamId: string; ids: string[] }[] = [];
    for (const [teamId, ps] of picksByTeam.entries()) {
      const ids = Array.from(new Set(ps.map((p) => p.golfer_id))).sort();
      if (ids.length >= 2) teamGolferLists.push({ teamId, ids });
    }
    const result: Record<number, { golferIds: string[]; teamIds: string[] }[]> = {};
    for (const k of [2, 3, 4, 5]) {
      const counts = new Map<string, { ids: string[]; teamIds: string[] }>();
      for (const { teamId, ids } of teamGolferLists) {
        if (ids.length < k) continue;
        for (const combo of combinations(ids, k)) {
          const key = combo.join("|");
          if (!counts.has(key)) counts.set(key, { ids: combo, teamIds: [] });
          counts.get(key)!.teamIds.push(teamId);
        }
      }
      const entries = Array.from(counts.values())
        .filter((c) => c.teamIds.length >= 2)
        .sort((a, b) => b.teamIds.length - a.teamIds.length);
      if (entries.length === 0) {
        result[k] = [];
        continue;
      }
      const top = entries[0].teamIds.length;
      result[k] = entries
        .filter((e) => e.teamIds.length === top)
        .slice(0, 3)
        .map((e) => ({ golferIds: e.ids, teamIds: e.teamIds }));
    }
    return result;
  }, [picksByTeam]);

  // ----- Section 4: Identical Teams -----
  const identicalTeams = useMemo(() => {
    const groups = new Map<string, { teamIds: string[]; golferIds: string[] }>();
    for (const [teamId, ps] of picksByTeam.entries()) {
      if (ps.length !== 7) continue;
      const ids = Array.from(new Set(ps.map((p) => p.golfer_id))).sort();
      const key = ids.join("|");
      if (!groups.has(key)) groups.set(key, { teamIds: [], golferIds: ids });
      groups.get(key)!.teamIds.push(teamId);
    }
    return Array.from(groups.values()).filter((g) => g.teamIds.length >= 2);
  }, [picksByTeam]);

  // ----- Section 5: Fun Facts -----
  const funFacts = useMemo(() => {
    const perTeam: {
      teamId: string;
      firstSubmitted: number;
      lastSubmitted: number;
      maxTweaks: number;
    }[] = [];
    for (const [teamId, ps] of picksByTeam.entries()) {
      let first = Infinity;
      let last = -Infinity;
      let maxT = 0;
      for (const p of ps) {
        const s = new Date(p.submitted_at).getTime();
        const e = new Date(p.last_edited_at).getTime();
        if (s < first) first = s;
        if (e > last) last = e;
        if ((p.tweak_count ?? 0) > maxT) maxT = p.tweak_count ?? 0;
      }
      perTeam.push({ teamId, firstSubmitted: first, lastSubmitted: last, maxTweaks: maxT });
    }
    const deadline = t ? new Date(t.submission_deadline).getTime() : null;

    const fastest = perTeam.length
      ? perTeam.reduce((a, b) => (a.firstSubmitted < b.firstSubmitted ? a : b))
      : null;
    // "Leaving it late" = max last_edited_at before deadline
    const latePool = deadline
      ? perTeam.filter((p) => p.lastSubmitted <= deadline)
      : perTeam;
    const late = latePool.length
      ? latePool.reduce((a, b) => (a.lastSubmitted > b.lastSubmitted ? a : b))
      : null;
    const tweaker = perTeam.length
      ? perTeam.reduce((a, b) => (a.maxTweaks > b.maxTweaks ? a : b))
      : null;

    return { fastest, late, tweaker, deadline };
  }, [picksByTeam, t]);

  // =============================================================
  // Render
  // =============================================================
  if (isLoading) {
    return (
      <div className="p-4 md:p-12 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !t) {
    return (
      <div className="p-4 md:p-12 max-w-5xl mx-auto">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load statistics. Please try again.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              tournamentQ.refetch();
              picksQ.refetch();
              golfersQ.refetch();
              teamsQ.refetch();
            }}
          >
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!VISIBLE_STATUSES.includes(t.status)) {
    return (
      <div className="p-4 md:p-12 max-w-5xl mx-auto">
        <Link
          to="/tournament/$id"
          params={{ id }}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <Card className="p-6 mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Statistics become available once picks close.
          </p>
        </Card>
      </div>
    );
  }

  const totalTeams = picksByTeam.size;

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto">
      <Link
        to="/tournament/$id"
        params={{ id }}
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-3 w-3" /> Back
      </Link>

      <header className="mt-4 mb-6">
        <p
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--gold, #b08a3e)" }}
        >
          Tournament Statistics
        </p>
        <h1 className="font-display text-3xl md:text-4xl mt-1 leading-tight">
          {t.name}
        </h1>
      </header>

      {/* ============ SUMMARY STAT CARDS ============ */}
      {(() => {
        const totalPicks = picks.length;
        const distinctGolfers = new Set(picks.map((p) => p.golfer_id)).size;
        const fieldSize = golfers.length;
        const pctField = fieldSize ? (distinctGolfers / fieldSize) * 100 : 0;
        const summary = [
          { label: "Teams", value: totalTeams.toString() },
          { label: "Total golfers picked", value: totalPicks.toString() },
          { label: "% of field picked", value: `${pctField.toFixed(1)}%` },
        ];
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {summary.map((s) => (
              <Card key={s.label} className="p-5 text-center shadow-sm">
                <p className="font-display text-3xl md:text-4xl leading-none tabular-nums">
                  {s.value}
                </p>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mt-2">
                  {s.label}
                </p>
              </Card>
            ))}
          </div>
        );
      })()}

      {/* ============ SECTION 1: Most Popular Picks ============ */}
      <Card className="p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg uppercase">Most Popular Picks</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={sortMode === "picks" ? "default" : "outline"}
              onClick={() => setSortMode("picks")}
            >
              By picks
            </Button>
            <Button
              size="sm"
              variant={sortMode === "ranking" ? "default" : "outline"}
              onClick={() => setSortMode("ranking")}
            >
              By ranking
            </Button>
          </div>
        </div>

        {mostPopular.length === 0 ? (
          <p className="text-sm text-muted-foreground">No picks yet.</p>
        ) : (
          <>
            <ol className="space-y-3">
              {visiblePopular.map((row, i) => (
                <li key={row.id} className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground w-6 tabular-nums pt-0.5">
                    {i + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{row.name}</span>
                        {row.owgr != null && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            #{row.owgr}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {row.count} ({row.pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div
                      className="mt-1.5 w-full bg-muted rounded-full overflow-hidden"
                      style={{ height: 5 }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, row.pct)}%`,
                          backgroundColor: "var(--forest-deep, #166534)",
                        }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {mostPopular.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAll ? "Show top 10" : `Show all ${mostPopular.length} golfers`}
              </button>
            )}
          </>
        )}
      </Card>

      {/* ============ SECTION 2: Unique Picks ============ */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg uppercase">Unique Picks</h2>
          <Badge variant="secondary" className="rounded-full text-xs">
            {uniquePicks.length}
          </Badge>
        </div>
        {uniquePicks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unique picks — every golfer is shared.</p>
        ) : (
          <div className="space-y-2">
            {uniquePicks.map((u, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium truncate">{u.golfer}</span>
                  {u.owgr != null && (
                    <span className="text-xs text-muted-foreground">#{u.owgr}</span>
                  )}
                  <span className="text-xs text-muted-foreground">Bucket {u.bucket}</span>
                </div>
                <span
                  className="shrink-0 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: "var(--forest-deep, #166534)" }}
                >
                  {u.team}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ============ SECTION 3: Popular Combinations ============ */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg uppercase">Popular Combinations</h2>
        </div>
        <div className="space-y-5">
          {[2, 3, 4, 5].map((k) => {
            const entries = comboSections[k] ?? [];
            const teamCount = entries[0]?.teamIds.length ?? 0;
            return (
              <div key={k}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Top {k}-pick combination
                  </h3>
                  {entries.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      · {teamCount} {teamCount === 1 ? "team" : "teams"}
                    </span>
                  )}
                </div>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No shared {k}-pick combinations.</p>
                ) : (
                  <div className="space-y-3">
                    {entries.map((e, idx) => (
                      <div key={idx} className="border border-border rounded-md p-3">
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {e.golferIds.map((gid) => (
                            <Badge key={gid} variant="secondary" className="text-xs">
                              {golferById.get(gid)?.golfer_name ?? "Unknown"}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {e.teamIds.map((tid) => (
                            <span
                              key={tid}
                              className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-foreground"
                            >
                              {teamById.get(tid)?.nickname ?? "Unknown"}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>


      {/* ============ SECTION 4: Identical Teams ============ */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg uppercase">Identical Teams</h2>
        </div>
        {identicalTeams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No identical teams — every entry is unique.</p>
        ) : (
          <div className="space-y-2">
            {identicalTeams.map((group, i) => (
              <div key={i} className="border border-border rounded-md p-3 text-sm">
                {group.map((tid) => teamById.get(tid)?.nickname ?? "Unknown").join(", ")}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ============ SECTION 5: Fun Facts ============ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Fastest entry</h3>
          </div>
          {funFacts.fastest ? (
            <>
              <p className="font-display text-lg leading-tight">
                {teamById.get(funFacts.fastest.teamId)?.nickname ?? "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(funFacts.fastest.firstSubmitted).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Leaving it late</h3>
          </div>
          {funFacts.late ? (
            <>
              <p className="font-display text-lg leading-tight">
                {teamById.get(funFacts.late.teamId)?.nickname ?? "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(funFacts.late.lastSubmitted).toLocaleString()}
                {funFacts.deadline && (
                  <>
                    {" "}
                    ({formatDuration(funFacts.deadline - funFacts.late.lastSubmitted)} before
                    deadline)
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Repeat className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Tweaker</h3>
          </div>
          {funFacts.tweaker && funFacts.tweaker.maxTweaks > 0 ? (
            <>
              <p className="font-display text-lg leading-tight">
                {teamById.get(funFacts.tweaker.teamId)?.nickname ?? "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {funFacts.tweaker.maxTweaks} tweak
                {funFacts.tweaker.maxTweaks === 1 ? "" : "s"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No tweaks recorded.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
