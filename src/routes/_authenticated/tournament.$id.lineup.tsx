import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/use-teams";
import { useImpersonation } from "@/context/impersonation-context";
import { Countdown } from "@/components/countdown";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tournament/$id/lineup")({
  component: LineupPicker,
});

function formatLastEdited(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTournamentYear(startDate: string): string {
  return new Date(startDate).getFullYear().toString();
}

function LineupPicker() {
  const { id } = Route.useParams();
  const { activeTeam } = useTeams();
  const { getEffectiveUserId, impersonatingId, impersonatedProfile } = useImpersonation();
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
        .from("picks")
        .select("*")
        .eq("team_id", activeTeam!.id)
        .eq("tournament_id", id);
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
      const { data } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", targetId)
        .maybeSingle();
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
  Object.values(byBucket).forEach((arr) =>
    arr.sort((a, b) => (a.owgr_rank ?? 999) - (b.owgr_rank ?? 999))
  );

  async function save() {
    if (!impersonatingId && isLocked) { toast.error("Picks are locked"); return; }
    const buckets = [1, 2, 3, 4, 5, 6, 7];
    const missing = buckets.filter((b) => !selections[b]);
    if (missing.length) { toast.error(`Select a golfer for tier ${missing.join(", ")}`); return; }

    const existingByBucket = new Map<number, any>(existingPicks.map((p: any) => [p.bucket, p]));
    const hadExisting = existingPicks.length > 0;

    let tweakIncrement = 0;
    if (hadExisting) {
      for (const b of buckets) {
        if (existingByBucket.get(b)?.golfer_id !== selections[b]) tweakIncrement++;
      }
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
          .update({ golfer_id: selections[b], last_edited_at: nowIso, tweak_count: newTweaks })
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

    if (impersonatingId) {
      void supabase.rpc("audit_admin_pick_edit", {
        _target: impersonatingId,
        _tournament: id,
        _after_lock: isLocked,
      });
      toast.success("Lineup saved on user's behalf (logged)");
    } else {
      toast.success("Lineup saved");
    }

    qc.invalidateQueries({ queryKey: ["picks"] });
    qc.invalidateQueries({ queryKey: ["roster-status"] });
    qc.invalidateQueries({ queryKey: ["missing-picks"] });
    navigate({ to: "/tournament/$id", params: { id } });
  }

  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const maxTweaks = Math.max(0, ...existingPicks.map((p: any) => p.tweak_count ?? 0));
  const hasSubmission = existingPicks.length > 0;
  const existingByBucketMap = new Map<number, any>(existingPicks.map((p: any) => [p.bucket, p]));

  const changedCount = buckets.reduce(
    (n, b) => n + (existingByBucketMap.get(b)?.golfer_id !== selections[b] ? 1 : 0),
    0,
  );
  const liveTweaks = maxTweaks + (hasSubmission ? changedCount : 0);

  // Last edited: max last_edited_at across all picks for this team/tournament
  const lastEditedIso: string | null = existingPicks.reduce((latest: string | null, p: any) => {
    if (!p.last_edited_at) return latest;
    if (!latest) return p.last_edited_at;
    return p.last_edited_at > latest ? p.last_edited_at : latest;
  }, null);

  const allSelected = buckets.every((b) => !!selections[b]);
  const teamHandle = activeTeam?.nickname || profile?.nickname || "Your Team";

  // Year suffix from tournament start_date
  const yearSuffix = tournament.start_date ? ` ${getTournamentYear(tournament.start_date)}` : "";

  return (
    <div className="p-4 md:p-12 max-w-4xl">
      <Link
        to={`/tournament/${id}`}
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        ← Tournament
      </Link>

      <header className="mt-4 mb-8">
        {/* Title block */}
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--gold)" }}
          >
            Select your picks
          </p>
          <h1 className="font-display text-4xl uppercase mt-1">
            {tournament.name}{yearSuffix}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{tournament.location}</p>
        </div>

        {/* Status row: pill + countdown on one line */}
        <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-3">
          {/* Picks status pill */}
          {allSelected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Picks selected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
              <XCircle className="h-3.5 w-3.5" />
              Picks not selected
            </span>
          )}

          {/* Separator + countdown — only show when not locked */}
          {!isLocked && (
            <>
              <span className="text-border select-none">|</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Picks close in
                </span>
                <Countdown targetIso={tournament.submission_deadline} />
              </div>
            </>
          )}
        </div>
      </header>

      {isLocked && (
        <div className="mb-6 p-4 border border-border bg-destructive/10 text-sm">
          Picks are locked for this tournament.
        </div>
      )}

      {field.length === 0 ? (
        <div className="border-2 border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            The admin hasn't committed a field for this tournament yet.
          </p>
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          {/* Card header: team name + tweaks + last edited */}
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="font-display uppercase text-base">{teamHandle}</span>
              {hasSubmission && <CheckCircle2 className="h-4 w-4 text-green-600" />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span>Tweaks: {liveTweaks}</span>
              {lastEditedIso && (
                <span>Last updated: {formatLastEdited(lastEditedIso)}</span>
              )}
            </div>
          </div>

          {/* Bucket rows */}
          <div className="divide-y divide-border border-b border-border">
            {buckets.map((b) => {
              const opts = byBucket[b] ?? [];
              const selected = selections[b];
              const isMissing = !selected;
              return (
                <div
                  key={b}
                  className="flex items-center gap-3 px-4 py-3"
                  style={
                    isMissing
                      ? { borderLeft: "3px solid var(--alert)", paddingLeft: 13 }
                      : undefined
                  }
                >
                  {/* Short bucket label */}
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground w-5 shrink-0">
                    B{b}
                  </span>

                  {/* Left-aligned dropdown, uniform width */}
                  <select
                    disabled={(!impersonatingId && isLocked) || opts.length === 0}
                    value={selected ?? ""}
                    onChange={(e) =>
                      setSelections((s) => ({ ...s, [b]: e.target.value }))
                    }
                    className="text-sm font-medium bg-transparent border-0 focus:outline-none focus:ring-0 disabled:opacity-50 cursor-pointer text-left"
                    style={{ width: "100%", maxWidth: 360 }}
                  >
                    <option value="">
                      {opts.length === 0 ? "No golfers in tier" : "— Select —"}
                    </option>
                    {opts.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.golfer_name}
                        {g.owgr_rank ? ` (OWGR #${g.owgr_rank})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {/* Admin override notice */}
          {impersonatingId && (
            <p className="px-5 pt-3 text-xs text-amber-700 font-semibold">
              Saving as {impersonatedProfile?.nickname ?? "user"} — admin override
              {isLocked ? " (after lock)" : ""}, logged.
            </p>
          )}

          {/* Save button */}
          <div className="px-5 py-4">
            <button
              onClick={save}
              disabled={!impersonatingId && isLocked}
              className="w-full py-4 font-display text-xs uppercase tracking-widest text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--forest-deep)" }}
            >
              Save Lineup
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
