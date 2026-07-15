import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Users,
  Zap,
  Clock,
  Repeat,
  ChevronRight,
  ChevronDown,
  Layers,
  Copy,
} from "lucide-react";
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
//   picks:   team_id, tournament_id, bucket, golfer_id,
//            submitted_at, last_edited_at, tweak_count
//   golfers: id, golfer_name, owgr_rank, bucket_number, tournament_id
//   teams:   id, nickname
//   tournaments: id, name, status, submission_deadline, start_date, location
// =============================================================
interface Tournament {
  id: string;
  name: string;
  status: string;
  submission_deadline: string;
  start_date: string | null;
  location: string | null;
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
  bucket_number: number | null;
}
interface Team {
  id: string;
  nickname: string;
}

const VISIBLE_STATUSES = ["picks_closed", "live", "completed"];
const BUCKETS = [1, 2, 3, 4, 5, 6, 7];

// =============================================================
// Helpers
// =============================================================

/**
 * Supabase silently caps result sets at 1,000 rows. At 7 picks per entry that
 * is only ~142 entries, which this pool is already close to. Every list query
 * below MUST page exhaustively or the stats quietly go wrong.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** All k-sized combinations of a sorted array of ids. */
function combinations<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const cur: T[] = [];
  (function walk(start: number) {
    if (cur.length === k) {
      res.push([...cur]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      walk(i + 1);
      cur.pop();
    }
  })(0);
  return res;
}

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// =============================================================
// Page
// =============================================================
function TournamentStatsPage() {
  const { id } = Route.useParams();
  const [showAllPopular, setShowAllPopular] = useState(false);
  const [popularSort, setPopularSort] = useState<"picks" | "ranking">("picks");
  const [openGolfer, setOpenGolfer] = useState<string | null>(null);
  const [openCombo, setOpenCombo] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<number | null>(1);

  const tournamentQ = useQuery({
    queryKey: ["t-stats", "tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, status, submission_deadline, start_date, location")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Tournament | null;
    },
  });

  const picksQ = useQuery({
    queryKey: ["t-stats", "picks", id],
    queryFn: async () =>
      fetchAll<Pick>((from, to) =>
        supabase
          .from("picks")
          .select(
            "team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count",
          )
          .eq("tournament_id", id)
          .range(from, to),
      ),
  });

  const golfersQ = useQuery({
    queryKey: ["t-stats", "golfers", id],
    queryFn: async () =>
      fetchAll<Golfer>((from, to) =>
        supabase
          .from("golfers")
          .select("id, golfer_name, owgr_rank, bucket_number")
          .eq("tournament_id", id)
          .range(from, to),
      ),
  });

  const teamIdsInTournament = useMemo(() => {
    const ids = new Set<string>();
    (picksQ.data ?? []).forEach((p) => ids.add(p.team_id));
    return Array.from(ids);
  }, [picksQ.data]);

  const teamsQ = useQuery({
    queryKey: ["t-stats", "teams", id, teamIdsInTournament.length],
    enabled: teamIdsInTournament.length > 0,
    queryFn: async () => {
      // .in() with a large id list can blow the URL length; chunk it.
      const chunkSize = 200;
      const out: Team[] = [];
      for (let i = 0; i < teamIdsInTournament.length; i += chunkSize) {
        const chunk = teamIdsInTournament.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("teams")
          .select("id, nickname")
          .in("id", chunk);
        if (error) throw error;
        out.push(...((data ?? []) as Team[]));
      }
      return out;
    },
  });

  const loading =
    tournamentQ.isLoading ||
    picksQ.isLoading ||
    golfersQ.isLoading ||
    (teamIdsInTournament.length > 0 && teamsQ.isLoading);

  const tournament = tournamentQ.data ?? null;
  const picks = picksQ.data ?? [];
  const golfers = golfersQ.data ?? [];
  const teams = teamsQ.data ?? [];

  const golferById = useMemo(() => {
    const m = new Map<string, Golfer>();
    golfers.forEach((g) => m.set(g.id, g));
    return m;
  }, [golfers]);

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => m.set(t.id, t.nickname ?? "Unknown"));
    return m;
  }, [teams]);

  const teamName = (tid: string) => teamNameById.get(tid) ?? "Unknown";

  /** team_id -> { bucket -> golfer_id } */
  const rosters = useMemo(() => {
    const m = new Map<string, Map<number, string>>();
    picks.forEach((p) => {
      if (!m.has(p.team_id)) m.set(p.team_id, new Map());
      m.get(p.team_id)!.set(p.bucket, p.golfer_id);
    });
    return m;
  }, [picks]);

  const entryCount = rosters.size;

  /** golfer_id -> team_ids that picked them */
  const backersByGolfer = useMemo(() => {
    const m = new Map<string, string[]>();
    picks.forEach((p) => {
      if (!m.has(p.golfer_id)) m.set(p.golfer_id, []);
      m.get(p.golfer_id)!.push(p.team_id);
    });
    return m;
  }, [picks]);

  // ---------------------------------------------------------
  // 01 Bucket concentration
  // ---------------------------------------------------------
  const bucketConcentration = useMemo(() => {
    return BUCKETS.map((b) => {
      const available = golfers.filter((g) => g.bucket_number === b).length;
      const inBucket = picks.filter((p) => p.bucket === b);
      const counts = new Map<string, number>();
      inBucket.forEach((p) =>
        counts.set(p.golfer_id, (counts.get(p.golfer_id) ?? 0) + 1),
      );
      let topId = "";
      let topN = 0;
      counts.forEach((n, gid) => {
        if (n > topN) {
          topN = n;
          topId = gid;
        }
      });
      const uniques = Array.from(counts.values()).filter((n) => n === 1).length;
      return {
        bucket: b,
        available,
        picked: counts.size,
        topName: golferById.get(topId)?.golfer_name ?? "—",
        topCount: topN,
        uniques,
      };
    });
  }, [golfers, picks, golferById]);

  // ---------------------------------------------------------
  // 02 Most popular picks
  // ---------------------------------------------------------
  const mostPopular = useMemo(() => {
    const rows = Array.from(backersByGolfer.entries()).map(([gid, teamIds]) => {
      const g = golferById.get(gid);
      return {
        golferId: gid,
        name: g?.golfer_name ?? "Unknown",
        owgr: g?.owgr_rank ?? null,
        bucket: g?.bucket_number ?? null,
        count: teamIds.length,
        teamIds,
      };
    });
    rows.sort((a, b) => {
      if (popularSort === "ranking") {
        const ar = a.owgr ?? 99999;
        const br = b.owgr ?? 99999;
        if (ar !== br) return ar - br;
      }
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [backersByGolfer, golferById, popularSort]);

  const maxPopular = mostPopular[0]?.count ?? 1;

  // ---------------------------------------------------------
  // 03 The herd's team
  // ---------------------------------------------------------
  const herd = useMemo(() => {
    const modal = new Map<number, { golferId: string; count: number }>();
    BUCKETS.forEach((b) => {
      const counts = new Map<string, number>();
      picks
        .filter((p) => p.bucket === b)
        .forEach((p) => counts.set(p.golfer_id, (counts.get(p.golfer_id) ?? 0) + 1));
      let topId = "";
      let topN = 0;
      counts.forEach((n, gid) => {
        if (n > topN) {
          topN = n;
          topId = gid;
        }
      });
      if (topId) modal.set(b, { golferId: topId, count: topN });
    });

    const closest = Array.from(rosters.entries())
      .map(([tid, r]) => {
        const matches: number[] = [];
        const deviates: number[] = [];
        BUCKETS.forEach((b) => {
          const m = modal.get(b);
          if (!m) return;
          if (r.get(b) === m.golferId) matches.push(b);
          else deviates.push(b);
        });
        return { teamId: tid, matched: matches.length, deviates };
      })
      .sort((a, b) => b.matched - a.matched || teamName(a.teamId).localeCompare(teamName(b.teamId)))
      .slice(0, 5);

    return {
      modal: BUCKETS.map((b) => ({
        bucket: b,
        name: golferById.get(modal.get(b)?.golferId ?? "")?.golfer_name ?? "—",
        count: modal.get(b)?.count ?? 0,
      })),
      closest,
      anyPerfect: closest.some((c) => c.matched === 7),
    };
  }, [picks, rosters, golferById, teamNameById]);

  // ---------------------------------------------------------
  // 04 Wolf index
  // ---------------------------------------------------------
  const wolf = useMemo(() => {
    const rows = Array.from(rosters.entries()).map(([tid, r]) => {
      const ids = Array.from(r.values());
      const total = ids.reduce(
        (acc, gid) => acc + (backersByGolfer.get(gid)?.length ?? 0),
        0,
      );
      return { teamId: tid, avg: ids.length ? total / ids.length : 0 };
    });
    rows.sort((a, b) => a.avg - b.avg);
    const vals = rows.map((r) => r.avg);
    const median = vals.length
      ? vals.length % 2
        ? vals[(vals.length - 1) / 2]
        : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
      : 0;
    return {
      rows,
      min: vals[0] ?? 0,
      max: vals[vals.length - 1] ?? 0,
      median,
      under15: vals.filter((v) => v < 15).length,
      over30: vals.filter((v) => v > 30).length,
    };
  }, [rosters, backersByGolfer]);

  // ---------------------------------------------------------
  // 05 Popular combinations
  // ---------------------------------------------------------
  const comboSections = useMemo(() => {
    return [2, 3, 4, 5].map((k) => {
      const counts = new Map<string, string[]>();
      rosters.forEach((r, tid) => {
        const ids = Array.from(r.values()).sort();
        if (ids.length < k) return;
        combinations(ids, k).forEach((combo) => {
          const key = combo.join("|");
          if (!counts.has(key)) counts.set(key, []);
          counts.get(key)!.push(tid);
        });
      });
      const entries = Array.from(counts.entries())
        .map(([key, teamIds]) => ({
          key,
          names: key
            .split("|")
            .map((gid) => golferById.get(gid)?.golfer_name ?? "Unknown"),
          teamIds,
        }))
        .filter((e) => e.teamIds.length >= 2)
        .sort(
          (a, b) =>
            b.teamIds.length - a.teamIds.length ||
            a.names.join().localeCompare(b.names.join()),
        )
        .slice(0, 4);
      return { k, entries };
    });
  }, [rosters, golferById]);

  // ---------------------------------------------------------
  // 06 Identical and near-identical
  // ---------------------------------------------------------
  const overlap = useMemo(() => {
    const list = Array.from(rosters.entries()).map(
      ([tid, r]) => [tid, new Set(r.values())] as const,
    );
    const identical: string[][] = [];
    const near: { a: string; b: string; shared: number }[] = [];
    let pairTotal = 0;
    let pairCount = 0;

    const sigGroups = new Map<string, string[]>();
    rosters.forEach((r, tid) => {
      const sig = Array.from(r.values()).sort().join("|");
      if (!sigGroups.has(sig)) sigGroups.set(sig, []);
      sigGroups.get(sig)!.push(tid);
    });
    sigGroups.forEach((tids) => {
      if (tids.length >= 2) identical.push(tids);
    });

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        let shared = 0;
        list[i][1].forEach((gid) => {
          if (list[j][1].has(gid)) shared++;
        });
        pairTotal += shared;
        pairCount++;
        if (shared === 6) near.push({ a: list[i][0], b: list[j][0], shared });
      }
    }
    near.sort((a, b) => teamName(a.a).localeCompare(teamName(b.a)));
    return {
      identical,
      near: near.slice(0, 6),
      avg: pairCount ? pairTotal / pairCount : 0,
    };
  }, [rosters, teamNameById]);

  // ---------------------------------------------------------
  // 07 Unique picks by bucket
  // ---------------------------------------------------------
  const uniqueByBucket = useMemo(() => {
    return BUCKETS.map((b) => {
      const items = picks
        .filter((p) => p.bucket === b)
        .filter((p) => (backersByGolfer.get(p.golfer_id)?.length ?? 0) === 1)
        .map((p) => ({
          golferId: p.golfer_id,
          name: golferById.get(p.golfer_id)?.golfer_name ?? "Unknown",
          owgr: golferById.get(p.golfer_id)?.owgr_rank ?? null,
          teamId: p.team_id,
        }))
        .sort((a, b2) => (a.owgr ?? 99999) - (b2.owgr ?? 99999));
      return { bucket: b, items };
    });
  }, [picks, backersByGolfer, golferById]);

  const uniqueTotal = useMemo(
    () => uniqueByBucket.reduce((acc, u) => acc + u.items.length, 0),
    [uniqueByBucket],
  );

  // ---------------------------------------------------------
  // 08 Entry timings (raw, from picks table only)
  // ---------------------------------------------------------
  const timings = useMemo(() => {
    const perTeam = new Map<
      string,
      { submitted: number; edited: number; tweaks: number }
    >();
    picks.forEach((p) => {
      const sub = new Date(p.submitted_at).getTime();
      const ed = new Date(p.last_edited_at).getTime();
      // tweak_count is a team-level counter denormalised onto all 7 pick rows.
      // Aggregate with MAX. Summing multiplies it by 7.
      const tw = p.tweak_count ?? 0;
      const cur = perTeam.get(p.team_id);
      if (!cur) perTeam.set(p.team_id, { submitted: sub, edited: ed, tweaks: tw });
      else {
        cur.submitted = Math.min(cur.submitted, sub);
        cur.edited = Math.max(cur.edited, ed);
        cur.tweaks = Math.max(cur.tweaks, tw);
      }
    });
    const rows = Array.from(perTeam.entries()).map(([teamId, v]) => ({
      teamId,
      ...v,
    }));
    const deadline = tournament?.submission_deadline
      ? new Date(tournament.submission_deadline).getTime()
      : null;
    const bySubmitted = [...rows].sort((a, b) => a.submitted - b.submitted);
    const byTweaks = [...rows].sort((a, b) => b.tweaks - a.tweaks);
    const byEdited = [...rows].sort((a, b) => b.edited - a.edited);
    return {
      first: bySubmitted[0] ?? null,
      last: bySubmitted[bySubmitted.length - 1] ?? null,
      tweakers: byTweaks.slice(0, 4),
      editors: byEdited.slice(0, 4),
      untouched: rows.filter((r) => r.tweaks === 0).length,
      total: rows.length,
      deadline,
    };
  }, [picks, tournament]);

  const distinctPicked = backersByGolfer.size;
  const fieldSize = golfers.length;

  // ---------------------------------------------------------
  // Guards
  // ---------------------------------------------------------
  if (loading) {
    return (
      <div className="mt-16 max-w-6xl mx-auto px-4 pb-16">
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64 mb-4" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="mt-16 max-w-6xl mx-auto px-4 pb-16 pt-4">
        <p className="text-muted-foreground">Tournament not found.</p>
      </div>
    );
  }

  if (!VISIBLE_STATUSES.includes(tournament.status)) {
    return (
      <div className="mt-16 max-w-6xl mx-auto px-4 pb-16 pt-4">
        <Link
          to="/tournament/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Card className="p-8 text-center">
          <BarChart3 className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-1">Stats are locked</h2>
          <p className="text-sm text-muted-foreground">
            Pick statistics are published once picks close for this tournament.
          </p>
        </Card>
      </div>
    );
  }

  const popularRows = showAllPopular ? mostPopular : mostPopular.slice(0, 10);

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------
  return (
    <div className="mt-16 max-w-6xl mx-auto px-4 pb-16">
      <div className="pt-4">
        <Link
          to="/tournament/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Tournament Stats</h1>
        <div className="mt-2">
          <div className="text-base font-bold">{tournament.name}</div>
          {tournament.location && (
            <div className="text-sm text-muted-foreground">{tournament.location}</div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <Kpi label="Entries" value={String(entryCount)} accent />
        <Kpi
          label={`Field picked · ${pct(distinctPicked, fieldSize)}`}
          value={`${distinctPicked}`}
          suffix={`/${fieldSize}`}
        />
        <Kpi label="Unique picks" value={String(uniqueTotal)} />
        <Kpi label="Identical teams" value={String(overlap.identical.length)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 01 Bucket concentration */}
        <Card className="p-4">
          <PanelHead n="01" title="Bucket Concentration" icon={Layers} />
          <Definition>
            <b className="text-foreground">Picked</b> distinct golfers chosen of those
            available · <b className="text-foreground">Uniques</b> golfers backed by
            exactly one team
          </Definition>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left py-1 w-6">B</th>
                <th className="text-left py-1">Most picked</th>
                <th className="text-left py-1 w-14">Picked</th>
                <th className="text-right py-1 w-14">Uniques</th>
              </tr>
            </thead>
            <tbody>
              {bucketConcentration.map((r) => {
                const starved = r.available > 0 && r.picked / r.available < 0.5;
                return (
                  <tr key={r.bucket} className="border-b border-border/50">
                    <td className="py-1.5">{r.bucket}</td>
                    <td className="py-1.5">
                      <span className="mr-1.5">{r.topName}</span>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        {pct(r.topCount, entryCount)}
                      </Badge>
                    </td>
                    <td
                      className={`py-1.5 tabular-nums ${
                        starved ? "text-destructive font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {r.picked}/{r.available}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.uniques}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* 02 Most popular */}
        <Card className="p-4">
          <PanelHead n="02" title="Most Popular Picks" icon={Users}>
            <span className="text-[10px] text-muted-foreground ml-auto">
              tap a row for backers
            </span>
          </PanelHead>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="w-4" />
                <th className="text-left py-1">Golfer</th>
                <th className="text-left py-1 w-6">B</th>
                <th className="text-right py-1 w-12">OWGR</th>
                <th className="text-right py-1 w-12">Picks</th>
                <th className="text-left py-1 w-[22%]">Share</th>
              </tr>
            </thead>
            <tbody>
              {popularRows.map((r) => {
                const open = openGolfer === r.golferId;
                return (
                  <>
                    <tr
                      key={r.golferId}
                      className="border-b border-border/50 cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpenGolfer(open ? null : r.golferId)}
                    >
                      <td className="py-1.5 text-muted-foreground">
                        {open ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </td>
                      <td className="py-1.5">{r.name}</td>
                      <td className="py-1.5 text-muted-foreground">{r.bucket ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {r.owgr ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1 rounded-full bg-primary inline-block"
                            style={{
                              width: `${Math.max(4, (r.count / maxPopular) * 60)}px`,
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {pct(r.count, entryCount)}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${r.golferId}-d`} className="bg-muted/40">
                        <td />
                        <td colSpan={5} className="py-2">
                          <TeamChips teamIds={r.teamIds} nameOf={teamName} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-3">
            {mostPopular.length > 10 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setShowAllPopular((s) => !s)}
              >
                {showAllPopular ? "Show top 10" : `Show all ${mostPopular.length}`}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Sort:{" "}
              <button
                className={popularSort === "picks" ? "text-foreground font-semibold" : ""}
                onClick={() => setPopularSort("picks")}
              >
                Picks
              </button>{" "}
              ·{" "}
              <button
                className={popularSort === "ranking" ? "text-foreground font-semibold" : ""}
                onClick={() => setPopularSort("ranking")}
              >
                OWGR
              </button>
            </span>
          </div>
        </Card>

        {/* 03 Herd */}
        <Card className="p-4">
          <PanelHead n="03" title="The Herd's Team" icon={Users} />
          <Definition>
            The most-picked golfer in each bucket.{" "}
            {herd.anyPerfect ? (
              <b className="text-foreground">Someone picked all seven.</b>
            ) : (
              <b className="text-foreground">Nobody picked all seven.</b>
            )}
          </Definition>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left py-1 w-6">B</th>
                <th className="text-left py-1">Most popular</th>
                <th className="text-right py-1 w-14">Picks</th>
              </tr>
            </thead>
            <tbody>
              {herd.modal.map((m) => (
                <tr key={m.bucket} className="border-b border-border/50">
                  <td className="py-1.5">{m.bucket}</td>
                  <td className="py-1.5">{m.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4 mb-1">
            Closest to the herd
          </div>
          <table className="w-full text-sm">
            <tbody>
              {herd.closest.map((c) => (
                <tr key={c.teamId} className="border-b border-border/50">
                  <td className="py-1.5">{teamName(c.teamId)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold w-12">
                    {c.matched}/7
                  </td>
                  <td className="py-1.5 text-right text-xs text-muted-foreground w-24">
                    {c.deviates.length ? `B${c.deviates.join(", B")}` : "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* 04 Wolf index */}
        <Card className="p-4">
          <PanelHead n="04" title="The Wolf Index" icon={Zap}>
            <span className="text-[10px] text-muted-foreground ml-auto">
              avg backers per pick
            </span>
          </PanelHead>
          <Definition>
            For each team: how many entries picked each of their 7 golfers, averaged.{" "}
            <b className="text-foreground">Lower means rarer picks.</b> Pool median{" "}
            <b className="text-foreground">{wolf.median.toFixed(1)}</b>.
          </Definition>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left py-1">Team</th>
                <th className="text-right py-1 w-20">Avg shared</th>
                <th className="text-left py-1 w-[30%]">Rarity</th>
              </tr>
            </thead>
            <tbody>
              {wolf.rows.slice(0, 5).map((r) => (
                <WolfRow
                  key={r.teamId}
                  name={teamName(r.teamId)}
                  avg={r.avg}
                  max={wolf.max}
                  rare
                />
              ))}
              <tr>
                <td colSpan={3} className="text-center text-muted-foreground py-1 opacity-50">
                  · · ·
                </td>
              </tr>
              {wolf.rows.slice(-3).map((r) => (
                <WolfRow
                  key={r.teamId}
                  name={teamName(r.teamId)}
                  avg={r.avg}
                  max={wolf.max}
                />
              ))}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mt-3">
            {wolf.under15} teams under 15 · {wolf.over30} teams above 30
          </div>
        </Card>

        {/* 05 Combinations */}
        <Card className="p-4 lg:col-span-2">
          <PanelHead n="05" title="Popular Combinations" icon={Copy}>
            <span className="text-[10px] text-muted-foreground ml-auto">
              tap any combo for backers
            </span>
          </PanelHead>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {comboSections.map((sec) => {
              const top = sec.entries[0];
              return (
                <div key={sec.k}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {["", "", "Top pair", "Top trio", "Top four", "Top five"][sec.k]}
                  </div>
                  {top ? (
                    <>
                      <div className="text-2xl font-extrabold text-primary leading-none">
                        {top.teamIds.length}{" "}
                        <span className="text-[11px] text-muted-foreground font-semibold">
                          · {pct(top.teamIds.length, entryCount)}
                        </span>
                      </div>
                      <div className="text-xs font-bold mt-1 leading-snug">
                        {top.names.join(" + ")}
                      </div>
                      <div className="mt-2">
                        <TeamChips teamIds={top.teamIds} nameOf={teamName} limit={5} />
                      </div>
                      <table className="w-full text-xs mt-2">
                        <tbody>
                          {sec.entries.slice(1).map((e) => {
                            const key = `${sec.k}-${e.key}`;
                            const open = openCombo === key;
                            return (
                              <>
                                <tr
                                  key={key}
                                  className="border-b border-border/50 cursor-pointer hover:bg-muted/40"
                                  onClick={() => setOpenCombo(open ? null : key)}
                                >
                                  <td className="py-1 w-3 text-muted-foreground">
                                    {open ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                  </td>
                                  <td className="py-1">{e.names.join(" + ")}</td>
                                  <td className="py-1 text-right tabular-nums">
                                    {e.teamIds.length}
                                  </td>
                                </tr>
                                {open && (
                                  <tr key={`${key}-d`}>
                                    <td />
                                    <td colSpan={2} className="pb-2">
                                      <TeamChips teamIds={e.teamIds} nameOf={teamName} />
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No shared combos.</div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* 06 Identical */}
        <Card className="p-4 lg:col-span-2">
          <PanelHead n="06" title="Identical & Near-Identical Teams" icon={Copy} />
          <Definition>
            Average overlap between any two entries:{" "}
            <b className="text-foreground">{overlap.avg.toFixed(2)} / 7</b>
          </Definition>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Perfect match
              </div>
              {overlap.identical.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No duplicate teams in this tournament.
                </div>
              ) : (
                overlap.identical.map((group, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-primary/40 bg-muted/40 p-3 mb-2"
                  >
                    <div className="text-sm font-extrabold text-primary leading-snug">
                      {group.map((t) => teamName(t)).join(" = ")}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      7/7 identical
                    </div>
                  </div>
                ))
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Near misses · 6/7 shared
              </div>
              {overlap.near.length === 0 ? (
                <div className="text-xs text-muted-foreground">None.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {overlap.near.map((n, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1.5">
                          {teamName(n.a)} &amp; {teamName(n.b)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">6/7</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Card>

        {/* 07 Unique picks */}
        <Card className="p-4 lg:col-span-2">
          <PanelHead n="07" title="Unique Picks" icon={Zap}>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {uniqueTotal} golfers with exactly one backer
            </span>
          </PanelHead>

          {/* Desktop: 7 columns */}
          <div className="hidden md:grid grid-cols-7 gap-2 items-start">
            {uniqueByBucket.map((u) => (
              <div
                key={u.bucket}
                className="rounded-lg border bg-muted/40 p-2 min-h-[70px]"
              >
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b">
                  <span className="text-[10px] font-extrabold text-muted-foreground">
                    B{u.bucket}
                  </span>
                  <span
                    className={`text-[11px] font-extrabold rounded-full px-1.5 ${
                      u.items.length
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground"
                    }`}
                  >
                    {u.items.length}
                  </span>
                </div>
                {u.items.length === 0 ? (
                  <div className="text-[9px] text-muted-foreground text-center py-2 opacity-50">
                    none
                  </div>
                ) : (
                  u.items.map((it) => (
                    <div
                      key={it.golferId}
                      className="py-1 border-b border-border/40 last:border-0"
                    >
                      <div className="text-[11px] font-bold leading-tight">{it.name}</div>
                      <div className="text-[10px] text-primary">{teamName(it.teamId)}</div>
                      <div className="text-[9px] text-muted-foreground">
                        OWGR {it.owgr ?? "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>

          {/* Mobile: accordion */}
          <div className="md:hidden space-y-1.5">
            {uniqueByBucket.map((u) => {
              const open = openBucket === u.bucket;
              return (
                <div key={u.bucket} className="rounded-lg border overflow-hidden">
                  <button
                    className={`w-full flex items-center gap-2 px-3 py-2 bg-muted/40 text-xs font-bold ${
                      u.items.length === 0 ? "opacity-50" : ""
                    }`}
                    onClick={() => setOpenBucket(open ? null : u.bucket)}
                  >
                    {open ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Bucket {u.bucket}
                    <span
                      className={`ml-auto text-[10px] font-extrabold rounded-full px-1.5 ${
                        u.items.length ? "text-primary bg-primary/10" : "text-muted-foreground"
                      }`}
                    >
                      {u.items.length}
                    </span>
                  </button>
                  {open && u.items.length > 0 && (
                    <div className="px-3 py-1">
                      {u.items.map((it) => (
                        <div
                          key={it.golferId}
                          className="flex items-baseline gap-2 py-1.5 border-b border-border/40 last:border-0"
                        >
                          <span className="text-[11px] font-bold">{it.name}</span>
                          <span className="text-[9px] text-muted-foreground">
                            {it.owgr ?? "—"}
                          </span>
                          <span className="text-[10px] text-primary ml-auto">
                            {teamName(it.teamId)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* 08 Entry timings */}
        <Card className="p-4 lg:col-span-2">
          <PanelHead n="08" title="Entry Timings" icon={Clock} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <TimingBlock
              icon={Clock}
              label="Fastest in"
              name={timings.first ? teamName(timings.first.teamId) : "—"}
              accent
              detail={
                timings.first
                  ? `${formatDateTime(new Date(timings.first.submitted).toISOString())}${
                      timings.deadline
                        ? ` · ${formatDuration(timings.deadline - timings.first.submitted)} early`
                        : ""
                    }`
                  : ""
              }
            />
            <TimingBlock
              icon={Clock}
              label="Last in"
              name={timings.last ? teamName(timings.last.teamId) : "—"}
              detail={
                timings.last
                  ? formatDateTime(new Date(timings.last.submitted).toISOString())
                  : ""
              }
            />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Most tweaks
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {timings.tweakers.map((t) => (
                    <tr key={t.teamId} className="border-b border-border/50">
                      <td className="py-1">{teamName(t.teamId)}</td>
                      <td className="py-1 text-right tabular-nums">{t.tweaks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Last to change their mind
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {timings.editors.map((t) => (
                    <tr key={t.teamId} className="border-b border-border/50">
                      <td className="py-1">{teamName(t.teamId)}</td>
                      <td className="py-1 text-right text-xs text-muted-foreground">
                        {formatDateTime(new Date(t.edited).toISOString())}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            <Repeat className="h-3 w-3 inline mr-1" />
            {timings.untouched} of {timings.total} never changed their picks after
            submitting.
          </div>
        </Card>
      </div>
    </div>
  );
}

// =============================================================
// Small presentational helpers
// =============================================================
function Kpi({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-3">
      <div
        className={`text-xl font-extrabold tracking-tight ${accent ? "text-primary" : ""}`}
      >
        {value}
        {suffix && (
          <span className="text-xs text-muted-foreground font-semibold">{suffix}</span>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </Card>
  );
}

function PanelHead({
  n,
  title,
  icon: Icon,
  children,
}: {
  n: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[11px] font-extrabold text-primary">{n}</span>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Definition({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-muted-foreground leading-relaxed pb-2 mb-2.5 border-b">
      {children}
    </div>
  );
}

function WolfRow({
  name,
  avg,
  max,
  rare,
}: {
  name: string;
  avg: number;
  max: number;
  rare?: boolean;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className={`py-1.5 ${rare ? "font-bold text-primary" : ""}`}>{name}</td>
      <td className="py-1.5 text-right tabular-nums font-semibold">{avg.toFixed(1)}</td>
      <td className="py-1.5">
        <span
          className={`h-1 rounded-full inline-block ${rare ? "bg-primary" : "bg-destructive"}`}
          style={{ width: `${Math.max(4, (avg / (max || 1)) * 60)}px` }}
        />
      </td>
    </tr>
  );
}

function TeamChips({
  teamIds,
  nameOf,
  limit = 12,
}: {
  teamIds: string[];
  nameOf: (id: string) => string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const names = useMemo(
    () => teamIds.map(nameOf).sort((a, b) => a.localeCompare(b)),
    [teamIds, nameOf],
  );
  const shown = expanded ? names : names.slice(0, limit);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((n) => (
        <span
          key={n}
          className="text-[10px] border rounded-full px-2 py-0.5 text-muted-foreground"
        >
          {n}
        </span>
      ))}
      {names.length > limit && (
        <button
          className="text-[10px] text-primary font-bold px-1"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((s) => !s);
          }}
        >
          {expanded ? "show less" : `+${names.length - limit} more`}
        </button>
      )}
    </div>
  );
}

function TimingBlock({
  icon: Icon,
  label,
  name,
  detail,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  name: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div
        className={`text-lg font-extrabold tracking-tight ${accent ? "text-primary" : ""}`}
      >
        {name}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>
    </div>
  );
}
