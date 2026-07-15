import {
  BUCKETS,
  type BucketConcentration,
  type ComboSection,
  type Golfer,
  type Herd,
  type Overlap,
  type Pick,
  type PopularPick,
  type StatsPack,
  type Team,
  type Timings,
  type TimingRow,
  type UniqueBucket,
  type Wolf,
} from "./types";

/**
 * Single source of truth for Major7s pick statistics.
 *
 * PURE. No React, no Supabase, no fetching, no dates-from-now. Given the same
 * rows it always returns the same pack, which is what makes it testable and
 * what stops the blog writer and the stats page from ever disagreeing.
 *
 * Callers are responsible for fetching. Note that Supabase silently caps result
 * sets at 1,000 rows: `picks` must be paged exhaustively before it reaches here
 * or every figure below is quietly wrong.
 */
export function buildStatsPack(
  picks: Pick[],
  golfers: Golfer[],
  teams: Team[],
): StatsPack {
  const golferById = new Map<string, Golfer>();
  golfers.forEach((g) => golferById.set(g.id, g));

  const teamNames: Record<string, string> = {};
  teams.forEach((t) => {
    teamNames[t.id] = t.nickname ?? "Unknown";
  });
  const nameOfTeam = (id: string) => teamNames[id] ?? "Unknown";

  // team_id -> bucket -> golfer_id
  const rosters = new Map<string, Map<number, string>>();
  picks.forEach((p) => {
    let r = rosters.get(p.team_id);
    if (!r) {
      r = new Map();
      rosters.set(p.team_id, r);
    }
    r.set(p.bucket, p.golfer_id);
  });

  // golfer_id -> team_ids that picked them
  const backersByGolfer = new Map<string, string[]>();
  picks.forEach((p) => {
    let b = backersByGolfer.get(p.golfer_id);
    if (!b) {
      b = [];
      backersByGolfer.set(p.golfer_id, b);
    }
    b.push(p.team_id);
  });

  const entryCount = rosters.size;
  const fieldSize = golfers.length;
  const distinctPicked = backersByGolfer.size;

  // ---------------------------------------------------------------
  // 01 Bucket concentration
  // ---------------------------------------------------------------
  const bucketConcentration: BucketConcentration[] = BUCKETS.map((b) => {
    const available = golfers.filter((g) => g.bucket_number === b).length;
    const counts = new Map<string, number>();
    picks
      .filter((p) => p.bucket === b)
      .forEach((p) => counts.set(p.golfer_id, (counts.get(p.golfer_id) ?? 0) + 1));

    let topGolferId = "";
    let topCount = 0;
    counts.forEach((n, gid) => {
      if (n > topCount) {
        topCount = n;
        topGolferId = gid;
      }
    });

    return {
      bucket: b,
      available,
      picked: counts.size,
      topGolferId,
      topName: golferById.get(topGolferId)?.golfer_name ?? "—",
      topCount,
      uniques: Array.from(counts.values()).filter((n) => n === 1).length,
    };
  });

  // ---------------------------------------------------------------
  // 02 Most popular picks (sorted by count desc; UI may re-sort by OWGR)
  // ---------------------------------------------------------------
  const mostPopular: PopularPick[] = Array.from(backersByGolfer.entries())
    .map(([golferId, teamIds]) => {
      const g = golferById.get(golferId);
      return {
        golferId,
        name: g?.golfer_name ?? "Unknown",
        owgr: g?.owgr_rank ?? null,
        bucket: g?.bucket_number ?? null,
        count: teamIds.length,
        teamIds,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // ---------------------------------------------------------------
  // 03 The herd's team
  // ---------------------------------------------------------------
  const modalByBucket = new Map<number, { golferId: string; count: number }>();
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
    if (topId) modalByBucket.set(b, { golferId: topId, count: topN });
  });

  const closestAll = Array.from(rosters.entries())
    .map(([teamId, r]) => {
      const deviates: number[] = [];
      let matched = 0;
      BUCKETS.forEach((b) => {
        const m = modalByBucket.get(b);
        if (!m) return;
        if (r.get(b) === m.golferId) matched++;
        else deviates.push(b);
      });
      return { teamId, matched, deviates };
    })
    .sort(
      (a, b) =>
        b.matched - a.matched || nameOfTeam(a.teamId).localeCompare(nameOfTeam(b.teamId)),
    );

  const herd: Herd = {
    modal: BUCKETS.map((b) => {
      const m = modalByBucket.get(b);
      return {
        bucket: b,
        golferId: m?.golferId ?? "",
        name: golferById.get(m?.golferId ?? "")?.golfer_name ?? "—",
        count: m?.count ?? 0,
      };
    }),
    closest: closestAll.slice(0, 5),
    anyPerfect: closestAll.some((c) => c.matched === BUCKETS.length),
  };

  // ---------------------------------------------------------------
  // 04 Wolf index: mean backers across a team's 7 picks. Lower = rarer.
  // ---------------------------------------------------------------
  const wolfRows = Array.from(rosters.entries())
    .map(([teamId, r]) => {
      const ids = Array.from(r.values());
      const total = ids.reduce(
        (acc, gid) => acc + (backersByGolfer.get(gid)?.length ?? 0),
        0,
      );
      return { teamId, avg: ids.length ? total / ids.length : 0 };
    })
    .sort((a, b) => a.avg - b.avg);

  const wolfVals = wolfRows.map((r) => r.avg);
  const wolfMedian = wolfVals.length
    ? wolfVals.length % 2
      ? wolfVals[(wolfVals.length - 1) / 2]
      : (wolfVals[wolfVals.length / 2 - 1] + wolfVals[wolfVals.length / 2]) / 2
    : 0;
  const wolfMin = wolfVals[0] ?? 0;
  const wolfMax = wolfVals[wolfVals.length - 1] ?? 0;

  const wolf: Wolf = {
    rows: wolfRows,
    min: wolfMin,
    max: wolfMax,
    median: wolfMedian,
    rarestTeamId: wolfRows[0]?.teamId ?? null,
    chalkiestTeamId: wolfRows[wolfRows.length - 1]?.teamId ?? null,
    ratio: wolfMin > 0 ? wolfMax / wolfMin : 0,
    under15: wolfVals.filter((v) => v < 15).length,
    over30: wolfVals.filter((v) => v > 30).length,
  };

  // ---------------------------------------------------------------
  // 05 Popular combinations (top 4 per size, descending)
  // ---------------------------------------------------------------
  const comboSections: ComboSection[] = [2, 3, 4, 5].map((k) => {
    const counts = new Map<string, string[]>();
    rosters.forEach((r, teamId) => {
      const ids = Array.from(r.values()).sort();
      if (ids.length < k) return;
      combinations(ids, k).forEach((combo) => {
        const key = combo.join("|");
        let list = counts.get(key);
        if (!list) {
          list = [];
          counts.set(key, list);
        }
        list.push(teamId);
      });
    });

    const entries = Array.from(counts.entries())
      .map(([key, teamIds]) => {
        const golferIds = key.split("|");
        return {
          key,
          golferIds,
          names: golferIds.map((gid) => golferById.get(gid)?.golfer_name ?? "Unknown"),
          teamIds,
        };
      })
      .filter((e) => e.teamIds.length >= 2)
      .sort(
        (a, b) =>
          b.teamIds.length - a.teamIds.length || a.names.join().localeCompare(b.names.join()),
      )
      .slice(0, 4);

    return { k, entries };
  });

  // ---------------------------------------------------------------
  // 06 Identical and near-identical
  // ---------------------------------------------------------------
  const sigGroups = new Map<string, string[]>();
  rosters.forEach((r, teamId) => {
    const sig = Array.from(r.values()).sort().join("|");
    let g = sigGroups.get(sig);
    if (!g) {
      g = [];
      sigGroups.set(sig, g);
    }
    g.push(teamId);
  });

  const identical: string[][] = [];
  sigGroups.forEach((tids) => {
    if (tids.length >= 2) identical.push(tids);
  });

  const rosterSets = Array.from(rosters.entries()).map(
    ([teamId, r]) => [teamId, new Set(r.values())] as const,
  );
  const near: Overlap["near"] = [];
  let pairTotal = 0;
  let pairCount = 0;
  for (let i = 0; i < rosterSets.length; i++) {
    for (let j = i + 1; j < rosterSets.length; j++) {
      let shared = 0;
      rosterSets[i][1].forEach((gid) => {
        if (rosterSets[j][1].has(gid)) shared++;
      });
      pairTotal += shared;
      pairCount++;
      if (shared === 6) near.push({ a: rosterSets[i][0], b: rosterSets[j][0], shared });
    }
  }
  near.sort((a, b) => nameOfTeam(a.a).localeCompare(nameOfTeam(b.a)));

  const overlap: Overlap = {
    identical,
    near: near.slice(0, 6),
    avg: pairCount ? pairTotal / pairCount : 0,
  };

  // ---------------------------------------------------------------
  // 07 Unique picks by bucket
  // ---------------------------------------------------------------
  const uniqueByBucket: UniqueBucket[] = BUCKETS.map((b) => ({
    bucket: b,
    items: picks
      .filter((p) => p.bucket === b)
      .filter((p) => (backersByGolfer.get(p.golfer_id)?.length ?? 0) === 1)
      .map((p) => ({
        golferId: p.golfer_id,
        name: golferById.get(p.golfer_id)?.golfer_name ?? "Unknown",
        owgr: golferById.get(p.golfer_id)?.owgr_rank ?? null,
        teamId: p.team_id,
      }))
      .sort((a, b2) => (a.owgr ?? 99999) - (b2.owgr ?? 99999)),
  }));

  const uniqueTotal = uniqueByBucket.reduce((acc, u) => acc + u.items.length, 0);

  // ---------------------------------------------------------------
  // 08 Entry timings
  // ---------------------------------------------------------------
  const perTeam = new Map<string, TimingRow>();
  picks.forEach((p) => {
    const submitted = new Date(p.submitted_at).getTime();
    const edited = new Date(p.last_edited_at).getTime();
    const tweaks = p.tweak_count ?? 0;
    const cur = perTeam.get(p.team_id);
    if (!cur) {
      perTeam.set(p.team_id, { teamId: p.team_id, submitted, edited, tweaks });
    } else {
      cur.submitted = Math.min(cur.submitted, submitted);
      cur.edited = Math.max(cur.edited, edited);
      // tweak_count is denormalised across all 7 rows: MAX, never SUM.
      cur.tweaks = Math.max(cur.tweaks, tweaks);
    }
  });

  const timingRows = Array.from(perTeam.values());
  const bySubmitted = [...timingRows].sort((a, b) => a.submitted - b.submitted);
  const timings: Timings = {
    first: bySubmitted[0] ?? null,
    last: bySubmitted[bySubmitted.length - 1] ?? null,
    tweakers: [...timingRows].sort((a, b) => b.tweaks - a.tweaks).slice(0, 4),
    editors: [...timingRows].sort((a, b) => b.edited - a.edited).slice(0, 4),
    untouched: timingRows.filter((r) => r.tweaks === 0).length,
    total: timingRows.length,
  };

  return {
    entryCount,
    fieldSize,
    distinctPicked,
    uniqueTotal,
    bucketConcentration,
    mostPopular,
    herd,
    wolf,
    comboSections,
    overlap,
    uniqueByBucket,
    timings,
    teamNames,
  };
}

/** All k-sized combinations of a sorted array. */
export function combinations<T>(arr: T[], k: number): T[][] {
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
