import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/use-teams";
import { useImpersonation } from "@/context/impersonation-context";
import { Countdown } from "@/components/countdown";
import { Card } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tournament/$id/lineup")({
  component: LineupPicker,
});

const BUCKET_LABELS: Record<number, string> = {
  1: "Bucket 1",
  2: "Bucket 2",
  3: "Bucket 3",
  4: "Bucket 4",
  5: "Bucket 5",
  6: "Bucket 6",
  7: "Bucket 7",
};

function LineupPicker() {
  const { id } = Route.useParams();
  const { activeTeam } = useTeams();
  const { getEffectiveUserId, impersonatingId } = useImpersonation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: tournament } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: field = [] } = useQuery({
    queryKey: ["field", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name, owgr_rank, bucket_number")
        .eq("tournament_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: existingPicks = [] } = useQuery({
    queryKey: ["picks", activeTeam?.id, id],
    enabled: !!activeTeam,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks").select("*")
        .eq("team_id", activeTeam!.id).eq("tournament_id", id);
      if (error) throw error;
      return data;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", "lineup", impersonatingId ?? "self"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const targetId = getEffectiveUserId(user?.id);
      if (!targetId) return null;
      const { data } = await supabase.from("profiles")
        .select("nickname").eq("id", targetId).maybeSingle();
      return data;
    },
  });

  const [selections, setSelections] = useState<Record<number, string>>({});
  useEffect(() => {
    const init: Record<number, string> = {};
    for (const p of existingPicks) init[p.bucket] = p.golfer_id;
    setSelections(init);
  }, [existingPicks]);

  if (!activeTeam) return <div className="p-12">Select a team first.</div>;
  if (!tournament) return <div className="p-12">Loading…</div>;

  const lockExpired = new Date(tournament.submission_deadline).getTime() <= Date.now();
  const isLocked = tournament.status !== "open_for_picks" || lockExpired;

  const byBucket: Record<number, any[]> = {};
  for (const g of field) {
    const b = g.bucket_number;
    if (!byBucket[b]) byBucket[b] = [];
    byBucket[b].push(g);
  }
  Object.values(byBucket).forEach((arr) => arr.sort((a, b) => (a.owgr_rank ?? 999) - (b.owgr_rank ?? 999)));

  async function save() {
    if (isLocked) { toast.error("Picks are locked"); return; }
    const buckets = [1, 2, 3, 4, 5, 6, 7];
    const missing = buckets.filter((b) => !selections[b]);
    if (missing.length) { toast.error(`Select a golfer for tier ${missing.join(", ")}`); return; }

    const existingByBucket = new Map<number, any>(existingPicks.map((p: any) => [p.bucket, p]));
    const hadExisting = existingPicks.length > 0;

    let tweakIncrement = 0;
    if (hadExisting) {
      if (existingByBucket.get(1)?.golfer_id !== selections[1]) tweakIncrement++;
      if (existingByBucket.get(2)?.golfer_id !== selections[2]) tweakIncrement++;
      if (existingByBucket.get(3)?.golfer_id !== selections[3]) tweakIncrement++;
      if (existingByBucket.get(4)?.golfer_id !== selections[4]) tweakIncrement++;
      if (existingByBucket.get(5)?.golfer_id !== selections[5]) tweakIncrement++;
      if (existingByBucket.get(6)?.golfer_id !== selections[6]) tweakIncrement++;
      if (existingByBucket.get(7)?.golfer_id !== selections[7]) tweakIncrement++;
    }

    const currentTweaks = existingPicks.reduce(
      (m: number, p: any) => Math.max(m, p.tweak_count ?? 0),
      0,
    );
    const newTweaks = currentTweaks + tweakIncrement;
    const nowIso = new Date().toISOString();

    for (const b of buckets) {
      const existing = existingByBucket.get(b);
      if (existing) {
        const { error } = await supabase
          .from("picks")
          .update({
            golfer_id: selections[b],
            last_edited_at: nowIso,
            tweak_count: newTweaks,
          })
          .eq("id", existing.id);
        if (error) { toast.error(error.message); return; }
      } else {
        const { error } = await supabase.from("picks").insert({
          tournament_id: id,
          team_id: activeTeam!.id,
          bucket: b,
          golfer_id: selections[b],
          tweak_count: newTweaks,
        });
        if (error) { toast.error(error.message); return; }
      }
    }
    toast.success("Lineup saved");
    qc.invalidateQueries({ queryKey: ["picks"] });
    qc.invalidateQueries({ queryKey: ["roster-status"] });
    qc.invalidateQueries({ queryKey: ["missing-picks"] });
    navigate({ to: "/tournament/$id", params: { id } });
  }

  const maxTweaks = Math.max(0, ...existingPicks.map((p: any) => p.tweak_count ?? 0));
  const hasSubmission = existingPicks.length > 0;
  const existingByBucketMap = new Map<number, any>(existingPicks.map((p: any) => [p.bucket, p]));
  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const changedCount = buckets.reduce(
    (n, b) => n + (existingByBucketMap.get(b)?.golfer_id !== selections[b] ? 1 : 0),
    0,
  );
  const liveTweaks = maxTweaks + (hasSubmission ? changedCount : 0);
  const teamHandle =
    activeTeam?.nickname || profile?.team_nickname || profile?.nickname || "Your Team";

  return (
    <div className="p-4 md:p-12 max-w-4xl">
      <Link to={`/tournament/${id}`} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Tournament</Link>

      <header className="mt-4 mb-8 flex justify-between items-end flex-wrap gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Build Lineup</p>
          <h1 className="font-display text-4xl uppercase mt-1">{tournament.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{tournament.location}</p>
        </div>
        {!isLocked && (
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Closes In</div>
            <Countdown targetIso={tournament.submission_deadline} />
          </div>
        )}
      </header>

      {isLocked && (
        <div className="mb-6 p-4 border border-border bg-destructive/10 text-sm">
          Picks are locked for this tournament.
        </div>
      )}

      {field.length === 0 ? (
        <div className="border-2 border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">The admin hasn't committed a field for this tournament yet.</p>
        </div>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-display uppercase text-base">{teamHandle}</span>
              {hasSubmission && <CheckCircle2 className="h-4 w-4 text-green-600" />}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Tweaks: {liveTweaks}
            </div>

            <div className="mt-4 divide-y divide-border border border-border">
              {buckets.map((b) => {
                const opts = byBucket[b] ?? [];
                const selected = selections[b];
                return (
                  <div
                    key={b}
                    className="flex items-center justify-between px-4 py-3 gap-4"
                    style={!selected ? { borderLeftWidth: 3, borderLeftColor: "var(--alert)" } : undefined}
                  >
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      Bucket {b}
                    </span>
                    <select
                      disabled={isLocked || opts.length === 0}
                      value={selected ?? ""}
                      onChange={(e) => setSelections((s) => ({ ...s, [b]: e.target.value }))}
                      className="text-sm font-medium text-right bg-transparent border-0 focus:outline-none focus:ring-0 max-w-[65%] truncate disabled:opacity-50 cursor-pointer"
                    >
                      <option value="">{opts.length === 0 ? "No golfers in tier" : "— Select —"}</option>
                      {opts.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.golfer_name}{g.owgr_rank ? ` (OWGR #${g.owgr_rank})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            <button
              onClick={save}
              disabled={isLocked}
              className="mt-5 w-full py-4 font-display text-xs uppercase tracking-widest text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--forest-deep)" }}
            >
              Save Lineup
            </button>
          </Card>
        </>
      )}
    </div>
  );
}
