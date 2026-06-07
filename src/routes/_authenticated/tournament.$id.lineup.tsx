import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeams } from "@/hooks/use-teams";
import { useImpersonation } from "@/context/impersonation-context";
import { Countdown } from "@/components/countdown";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Check, ChevronDown, X, XCircle, Shuffle, RefreshCw, Play } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tournament/$id/lineup")({
  component: LineupPicker,
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatLastEdited(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
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

// ─── types ────────────────────────────────────────────────────────────────────

interface Golfer {
  id: string;
  golfer_name: string;
  owgr_rank: number | null;
  bucket_number: number;
}

// ─── BucketRow ────────────────────────────────────────────────────────────────
// Desktop: clicking expands an inline accordion beneath the row.
// Mobile (<640px): clicking opens the bottom sheet instead.

interface BucketRowProps {
  bucket: number;
  golfers: Golfer[];
  selectedId: string | undefined;
  disabled: boolean;
  onChange: (golferId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  onOpenSheet: () => void;
}

function BucketRow({
  bucket,
  golfers,
  selectedId,
  disabled,
  onChange,
  isOpen,
  onToggle,
  onOpenSheet,
}: BucketRowProps) {
  const selectedGolfer = golfers.find((g) => g.id === selectedId);
  const isMissing = !selectedId;

  function handleRowClick() {
    if (disabled) return;
    if (window.innerWidth < 640) {
      onOpenSheet();
    } else {
      onToggle();
    }
  }

  return (
    <>
      {/* Trigger row */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
          }
        }}
        className={[
          "flex items-center gap-3 px-4 py-3 border-b border-border transition-colors",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40",
          isOpen ? "bg-muted/40" : "",
          isMissing ? "border-l-[3px] border-l-destructive pl-[13px]" : "",
        ].join(" ")}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-5 shrink-0">
          B{bucket}
        </span>
        <span
          className={`text-sm flex-1 ${
            selectedGolfer ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {selectedGolfer
            ? `${selectedGolfer.golfer_name}${selectedGolfer.owgr_rank ? ` (OWGR #${selectedGolfer.owgr_rank})` : ""}`
            : golfers.length === 0
            ? "No golfers in tier"
            : "— Select —"}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Desktop inline accordion — hidden on mobile via sm: */}
      {isOpen && (
        <div className="hidden sm:block border-b border-border bg-muted/30">
          {golfers.map((g) => {
            const isSel = g.id === selectedId;
            return (
              <div
                key={g.id}
                role="option"
                aria-selected={isSel}
                tabIndex={0}
                onClick={() => {
                  onChange(g.id);
                  onToggle();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onChange(g.id);
                    onToggle();
                  }
                }}
                className={[
                  "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border last:border-b-0 transition-colors",
                  isSel
                    ? "bg-green-50 dark:bg-green-950/30"
                    : "hover:bg-muted/60",
                ].join(" ")}
              >
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isSel ? "text-green-700" : "text-transparent"
                  }`}
                />
                <span
                  className={`text-sm flex-1 ${
                    isSel
                      ? "font-medium text-green-800 dark:text-green-300"
                      : "text-foreground"
                  }`}
                >
                  {g.golfer_name}
                </span>
                {g.owgr_rank && (
                  <span
                    className={`text-xs ${
                      isSel
                        ? "text-green-700 dark:text-green-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    OWGR #{g.owgr_rank}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── BottomSheet ──────────────────────────────────────────────────────────────
// Mobile-only slide-up picker. Rendered at the top of LineupPicker so it
// sits above the card in the DOM, avoiding any clipping issues.

interface BottomSheetProps {
  bucket: number | null;
  golfers: Golfer[];
  selectedId: string | undefined;
  onSelect: (bucket: number, golferId: string) => void;
  onClose: () => void;
}

function BottomSheet({
  bucket,
  golfers,
  selectedId,
  onSelect,
  onClose,
}: BottomSheetProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prevent body scroll while sheet is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  if (bucket === null) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className="sm:hidden fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.4)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Select golfer for Bucket ${bucket}`}
    >
      <div className="w-full bg-background rounded-t-2xl overflow-hidden max-h-[72vh] flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Bucket {bucket}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="overflow-y-auto flex-1 overscroll-contain">
          {golfers.map((g) => {
            const isSel = g.id === selectedId;
            return (
              <div
                key={g.id}
                role="option"
                aria-selected={isSel}
                tabIndex={0}
                onClick={() => { onSelect(bucket, g.id); onClose(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { onSelect(bucket, g.id); onClose(); }
                }}
                className={[
                  "flex items-center gap-3 px-5 py-4 border-b border-border last:border-b-0 cursor-pointer transition-colors",
                  isSel
                    ? "bg-green-50 dark:bg-green-950/30"
                    : "hover:bg-muted/50 active:bg-muted",
                ].join(" ")}
              >
                <Check
                  className={`h-4 w-4 shrink-0 ${
                    isSel ? "text-green-700" : "text-transparent"
                  }`}
                />
                <span
                  className={`text-sm flex-1 ${
                    isSel
                      ? "font-medium text-green-800 dark:text-green-300"
                      : "text-foreground"
                  }`}
                >
                  {g.golfer_name}
                </span>
                {g.owgr_rank && (
                  <span
                    className={`text-xs ${
                      isSel ? "text-green-700" : "text-muted-foreground"
                    }`}
                  >
                    OWGR #{g.owgr_rank}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── PicksHelper ──────────────────────────────────────────────────────────────

interface PicksHelperProps {
  byBucket: Record<number, Golfer[]>;
  selections: Record<number, string>;
  setSelections: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  isLocked: boolean;
}

function PicksHelper({ byBucket, selections, setSelections, isLocked }: PicksHelperProps) {
  const buckets = [1, 2, 3, 4, 5, 6, 7];

  // Which buckets the user wants the helper to target
  const [targetBuckets, setTargetBuckets] = useState<Set<number>>(
    new Set(buckets)
  );

  // Staged suggestions: bucket → golfer id. null means no suggestion yet.
  const [suggestions, setSuggestions] = useState<Record<number, string> | null>(null);

  // Whether deploy just ran (for brief confirmation state)
  const [deployed, setDeployed] = useState(false);

  const allActive = buckets.every((b) => targetBuckets.has(b));

  function toggleAll() {
    setTargetBuckets(allActive ? new Set() : new Set(buckets));
    setSuggestions(null);
  }

  function toggleBucket(b: number) {
    setTargetBuckets((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });
    setSuggestions(null);
  }

  function pickRandom(pool: Golfer[]): string {
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  function generateSuggestions() {
    const result: Record<number, string> = {};
    for (const b of buckets) {
      if (!targetBuckets.has(b)) continue;
      const pool = byBucket[b] ?? [];
      if (pool.length === 0) continue; // silently skip empty buckets
      result[b] = pickRandom(pool);
    }
    setSuggestions(result);
    setDeployed(false);
  }

  function rerollBucket(b: number) {
    const pool = byBucket[b] ?? [];
    if (pool.length === 0) return;
    setSuggestions((prev) => ({ ...(prev ?? {}), [b]: pickRandom(pool) }));
    setDeployed(false);
  }

  function deploy() {
    if (!suggestions) return;
    setSelections((prev) => ({ ...prev, ...suggestions }));
    setDeployed(true);
  }

  const activeSuggestedBuckets = suggestions
    ? Object.keys(suggestions).map(Number).filter((b) => suggestions[b])
    : [];

  const deployLabel = activeSuggestedBuckets.length
    ? `Deploy to ${activeSuggestedBuckets.map((b) => `B${b}`).join(", ")}`
    : "Deploy";

  return (
    <div className="mt-6">
      {/* Section heading */}
      <p
        className="text-[10px] font-bold uppercase tracking-widest mb-1"
        style={{ color: "var(--gold)" }}
      >
        Picks helper
      </p>
      <h2 className="font-display text-xl uppercase mb-1">Random</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Suggest a random golfer per bucket. Review the picks, then deploy into your lineup.
      </p>

      <Card className="p-0 overflow-hidden">
        {/* Helper header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-border">
          <div
            className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: "var(--forest-deep)" }}
          >
            <Shuffle className="h-4 w-4" style={{ color: "var(--gold)" }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Random pick</p>
            <p className="text-xs text-muted-foreground">
              Picks a random golfer from each selected bucket
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Bucket selector */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Apply to buckets
            </p>
            <div className="flex flex-wrap gap-2">
              {/* All toggle */}
              <button
                onClick={toggleAll}
                className={[
                  "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                  allActive
                    ? "text-[#1a2a10] border-transparent"
                    : "text-muted-foreground border-border bg-transparent hover:bg-muted/40",
                ].join(" ")}
                style={allActive ? { backgroundColor: "var(--gold)", borderColor: "var(--gold)" } : {}}
              >
                All
              </button>
              {buckets.map((b) => {
                const isActive = targetBuckets.has(b);
                const isEmpty = (byBucket[b] ?? []).length === 0;
                return (
                  <button
                    key={b}
                    onClick={() => toggleBucket(b)}
                    disabled={isEmpty}
                    className={[
                      "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                      isEmpty
                        ? "opacity-30 cursor-not-allowed text-muted-foreground border-border"
                        : isActive
                        ? "text-green-100 border-transparent"
                        : "text-muted-foreground border-border bg-transparent hover:bg-muted/40",
                    ].join(" ")}
                    style={isActive && !isEmpty ? { backgroundColor: "var(--forest-deep)", borderColor: "var(--forest-deep)" } : {}}
                  >
                    B{b}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Suggest / Re-roll all */}
          <div className="flex gap-2">
            <button
              onClick={generateSuggestions}
              disabled={isLocked || targetBuckets.size === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold uppercase tracking-wider text-white rounded disabled:opacity-40 transition-colors"
              style={{ backgroundColor: "var(--forest-deep)" }}
            >
              <Shuffle className="h-3.5 w-3.5" />
              {suggestions ? "Re-roll all" : "Suggest picks"}
            </button>
            {suggestions && (
              <button
                onClick={() => { setSuggestions(null); setDeployed(false); }}
                className="px-3 py-2.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
                aria-label="Clear suggestions"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Suggestions preview */}
          {suggestions && (
            <div className="rounded border border-border overflow-hidden">
              {buckets.map((b) => {
                const isTargeted = targetBuckets.has(b);
                const golferId = suggestions[b];
                const golfer = golferId
                  ? (byBucket[b] ?? []).find((g) => g.id === golferId)
                  : null;

                return (
                  <div
                    key={b}
                    className={[
                      "flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0",
                      !isTargeted || !golferId ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-5 shrink-0">
                      B{b}
                    </span>

                    {!isTargeted || !golferId ? (
                      <span className="text-sm text-muted-foreground flex-1">—</span>
                    ) : (
                      <>
                        <span className="text-sm flex-1">{golfer?.golfer_name ?? "Unknown"}</span>
                        {golfer?.owgr_rank && (
                          <span className="text-xs text-muted-foreground">
                            OWGR #{golfer.owgr_rank}
                          </span>
                        )}
                        <button
                          onClick={() => rerollBucket(b)}
                          className="ml-1 p-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
                          aria-label={`Re-roll B${b}`}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Deploy */}
          {suggestions && activeSuggestedBuckets.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={deploy}
                disabled={deployed || isLocked}
                className={[
                  "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold uppercase tracking-wider rounded border transition-colors disabled:opacity-50",
                  deployed
                    ? "border-green-300 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                    : "border-border hover:bg-muted/40",
                ].join(" ")}
              >
                {deployed ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Deployed — save your lineup to confirm
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    {deployLabel}
                  </>
                )}
              </button>
              <p className="text-xs text-muted-foreground leading-tight max-w-[140px]">
                Other buckets unchanged. Save lineup to confirm.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── LineupPicker (page) ──────────────────────────────────────────────────────

function LineupPicker() {
  const { id } = Route.useParams();
  const { activeTeam } = useTeams();
  const { getEffectiveUserId, impersonatingId, impersonatedProfile } = useImpersonation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: tournament } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", id)
        .single();
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
      return (data ?? []) as Golfer[];
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
  const [openAccordion, setOpenAccordion] = useState<number | null>(null);
  const [sheetBucket, setSheetBucket] = useState<number | null>(null);

  useEffect(() => {
    const init: Record<number, string> = {};
    for (const p of existingPicks) init[p.bucket] = p.golfer_id;
    setSelections(init);
  }, [existingPicks]);

  if (!activeTeam) return <div className="p-12">Select a team first.</div>;
  if (!tournament) return <div className="p-12">Loading…</div>;

  const lockExpired =
    new Date(tournament.submission_deadline).getTime() <= Date.now();
  const isLocked = tournament.status !== "open_for_picks" || lockExpired;

  // Build byBucket sorted by OWGR rank
  const byBucket: Record<number, Golfer[]> = {};
  for (const g of field) {
    const b = g.bucket_number;
    if (!byBucket[b]) byBucket[b] = [];
    byBucket[b].push(g);
  }
  Object.values(byBucket).forEach((arr) =>
    arr.sort((a, b) => (a.owgr_rank ?? 999) - (b.owgr_rank ?? 999))
  );

  const buckets = [1, 2, 3, 4, 5, 6, 7];

  async function save() {
    if (!impersonatingId && isLocked) {
      toast.error("Picks are locked");
      return;
    }
    const missing = buckets.filter((b) => !selections[b]);
    if (missing.length) {
      toast.error(`Select a golfer for tier ${missing.join(", ")}`);
      return;
    }

    const existingByBucket = new Map<number, any>(
      existingPicks.map((p: any) => [p.bucket, p])
    );
    const hadExisting = existingPicks.length > 0;

    let tweakIncrement = 0;
    if (hadExisting) {
      for (const b of buckets) {
        if (existingByBucket.get(b)?.golfer_id !== selections[b])
          tweakIncrement++;
      }
    }

    const currentTweaks = existingPicks.reduce(
      (m: number, p: any) => Math.max(m, p.tweak_count ?? 0),
      0
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

  // Derived values
  const maxTweaks = Math.max(
    0,
    ...existingPicks.map((p: any) => p.tweak_count ?? 0)
  );
  const hasSubmission = existingPicks.length > 0;
  const existingByBucketMap = new Map<number, any>(
    existingPicks.map((p: any) => [p.bucket, p])
  );
  const changedCount = buckets.reduce(
    (n, b) =>
      n + (existingByBucketMap.get(b)?.golfer_id !== selections[b] ? 1 : 0),
    0
  );
  const liveTweaks = maxTweaks + (hasSubmission ? changedCount : 0);

  const lastEditedIso: string | null = existingPicks.reduce(
    (latest: string | null, p: any) => {
      if (!p.last_edited_at) return latest;
      if (!latest) return p.last_edited_at;
      return p.last_edited_at > latest ? p.last_edited_at : latest;
    },
    null
  );

  const allSelected = buckets.every((b) => !!selections[b]);
  const teamHandle =
    activeTeam?.nickname || profile?.nickname || "Your Team";
  const yearSuffix = tournament.start_date
    ? ` ${getTournamentYear(tournament.start_date)}`
    : "";

  // ── Shared inner content blocks (used in both layout modes) ──────────────

  const headerBlock = (
    <header className="mt-4 mb-8">
      <p
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--gold)" }}
      >
        Select your picks
      </p>
      <h1 className="font-display text-4xl uppercase mt-1">
        {tournament.name}{yearSuffix}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        {tournament.location}
      </p>
      <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-3">
        {allSelected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Picks selected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
            <XCircle className="h-3.5 w-3.5" />
            Picks not selected
          </span>
        )}
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
  );

  const lockedBanner = isLocked && (
    <div className="mb-6 p-4 border border-border bg-destructive/10 text-sm">
      Picks are locked for this tournament.
    </div>
  );

  const picksCard = field.length === 0 ? (
    <div className="border-2 border-dashed border-border p-12 text-center">
      <p className="text-sm text-muted-foreground">
        The admin hasn't committed a field for this tournament yet.
      </p>
    </div>
  ) : (
    <Card className="p-0 overflow-hidden">
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

      <div>
        {buckets.map((b) => (
          <BucketRow
            key={b}
            bucket={b}
            golfers={byBucket[b] ?? []}
            selectedId={selections[b]}
            disabled={
              (!impersonatingId && isLocked) ||
              (byBucket[b] ?? []).length === 0
            }
            onChange={(golferId) =>
              setSelections((s) => ({ ...s, [b]: golferId }))
            }
            isOpen={openAccordion === b}
            onToggle={() =>
              setOpenAccordion((prev) => (prev === b ? null : b))
            }
            onOpenSheet={() => setSheetBucket(b)}
          />
        ))}
      </div>

      {impersonatingId && (
        <p className="px-5 pt-3 text-xs text-amber-700 font-semibold">
          Saving as {impersonatedProfile?.nickname ?? "user"} — admin
          override{isLocked ? " (after lock)" : ""}, logged.
        </p>
      )}

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
  );

  const helperBlock = field.length > 0 && (
    <PicksHelper
      byBucket={byBucket}
      selections={selections}
      setSelections={setSelections}
      isLocked={!impersonatingId && isLocked}
    />
  );

  return (
    <>
      {/* Bottom sheet — mobile only */}
      {sheetBucket !== null && (
        <BottomSheet
          bucket={sheetBucket}
          golfers={byBucket[sheetBucket] ?? []}
          selectedId={selections[sheetBucket]}
          onSelect={(b, golferId) =>
            setSelections((s) => ({ ...s, [b]: golferId }))
          }
          onClose={() => setSheetBucket(null)}
        />
      )}

      {/* ── Mobile / small desktop: stacked (< lg) ── */}
      <div className="lg:hidden p-4 md:p-12 max-w-4xl">
        <Link
          to={`/tournament/${id}`}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Tournament
        </Link>
        {headerBlock}
        {lockedBanner}
        {picksCard}
        {helperBlock}
      </div>

      {/* ── Desktop: side-by-side (lg+) ── */}
      <div className="hidden lg:flex flex-col h-screen overflow-hidden">
        {/* Top bar: back link + header, full width */}
        <div className="px-8 pt-8 pb-0 shrink-0">
          <Link
            to={`/tournament/${id}`}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Tournament
          </Link>
          {headerBlock}
          {lockedBanner}
        </div>

        {/* Two-column body, each side independently scrollable */}
        <div className="flex flex-1 gap-6 px-8 pb-8 overflow-hidden">
          {/* Left: picks card */}
          <div className="flex-1 overflow-y-auto">
            {picksCard}
          </div>

          {/* Right: picks helper */}
          <div className="flex-1 overflow-y-auto">
            {helperBlock}
          </div>
        </div>
      </div>
    </>
  );
}
