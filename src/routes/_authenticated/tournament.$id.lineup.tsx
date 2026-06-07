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

type HelperMode = "random" | "top-ranked" | "contrarian" | "last-major" | "same-tournament";

// golfer_id → { points, tournamentName } for best historical finish
interface HistoricalBestByGolfer {
  [golferId: string]: { points: number; tournamentName: string; year: number };
}

interface PicksHelperProps {
  byBucket: Record<number, Golfer[]>;
  selections: Record<number, string>;
  setSelections: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  isLocked: boolean;
  tournamentPickCounts: Record<string, number>;
  onDeploy: () => void;
  lastMajorBest: HistoricalBestByGolfer;       // best finish in most recent completed major
  sameTournamentBest: HistoricalBestByGolfer;   // best finish in same tournament (prior years)
  currentTournamentName: string;
}

// Shared bucket toggle + suggestion list + deploy UI used by all modes
interface HelperPanelProps {
  buckets: number[];
  byBucket: Record<number, Golfer[]>;
  targetBuckets: Set<number>;
  toggleAll: () => void;
  toggleBucket: (b: number) => void;
  allActive: boolean;
  suggestions: Record<number, string> | null;
  setSuggestions: (s: Record<number, string> | null) => void;
  deployed: boolean;
  setDeployed: (v: boolean) => void;
  onGenerate: () => void;
  onRerollBucket?: (b: number) => void;
  isLocked: boolean;
  generateLabel: string;
  generateIcon: React.ReactNode;
  setSelections: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onDeploy: () => void;
  historicalData?: HistoricalBestByGolfer; // if present, show finish context in suggestion rows
}

function HelperPanel({
  buckets, byBucket, targetBuckets, toggleAll, toggleBucket, allActive,
  suggestions, setSuggestions, deployed, setDeployed,
  onGenerate, onRerollBucket, isLocked,
  generateLabel, generateIcon, setSelections, onDeploy, historicalData,
}: HelperPanelProps) {
  const activeSuggestedBuckets = suggestions
    ? Object.keys(suggestions).map(Number).filter((b) => !!suggestions[b])
    : [];

  const deployLabel = activeSuggestedBuckets.length
    ? `Deploy to ${activeSuggestedBuckets.map((b) => `B${b}`).join(", ")}`
    : "Deploy";

  function deploy() {
    if (!suggestions) return;
    setSelections((prev) => ({ ...prev, ...suggestions }));
    setDeployed(true);
    onDeploy();
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Bucket selector */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Apply to buckets
        </p>
        <p className="text-xs text-muted-foreground mb-2">
          Select 'All' or choose any combination of individual buckets
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleAll}
            className={[
              "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
              allActive
                ? "text-white border-transparent"
                : "text-muted-foreground border-border bg-transparent hover:bg-muted/40",
            ].join(" ")}
            style={allActive ? { backgroundColor: "var(--forest-deep)", borderColor: "var(--forest-deep)" } : {}}
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
                    ? "border-transparent text-[#1a2a10]"
                    : "text-muted-foreground border-border bg-transparent hover:bg-muted/40",
                ].join(" ")}
                style={isActive && !isEmpty ? { backgroundColor: "var(--gold)", borderColor: "var(--gold)" } : {}}
              >
                B{b}
              </button>
            );
          })}
        </div>
      </div>

      {/* Generate / Re-generate */}
      <div className="flex gap-2">
        <button
          onClick={onGenerate}
          disabled={isLocked || targetBuckets.size === 0}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold uppercase tracking-wider text-white rounded disabled:opacity-40 transition-colors"
          style={{ backgroundColor: "var(--forest-deep)" }}
        >
          {generateIcon}
          {suggestions ? `Re-run` : generateLabel}
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
                    {historicalData && golfer && historicalData[golfer.id] ? (
                      <span className="text-xs text-muted-foreground">
                        P{historicalData[golfer.id].points} · {historicalData[golfer.id].tournamentName} {historicalData[golfer.id].year}
                      </span>
                    ) : golfer?.owgr_rank ? (
                      <span className="text-xs text-muted-foreground">
                        OWGR #{golfer.owgr_rank}
                      </span>
                    ) : null}
                    {onRerollBucket && (
                      <button
                        onClick={() => { onRerollBucket(b); setDeployed(false); }}
                        className="ml-1 p-1.5 rounded border border-border text-muted-foreground hover:bg-muted/40 transition-colors"
                        aria-label={`Re-roll B${b}`}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deploy */}
      {suggestions && activeSuggestedBuckets.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={deploy}
            disabled={deployed || isLocked}
            className={[
              "w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold uppercase tracking-wider rounded border transition-colors disabled:opacity-50",
              deployed
                ? "border-green-300 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                : "text-white border-transparent",
            ].join(" ")}
            style={!deployed ? { backgroundColor: "var(--gold)", borderColor: "var(--gold)", color: "#1a2a10" } : {}}
          >
            {deployed ? (
              <><Check className="h-3.5 w-3.5" />Deployed</>
            ) : (
              <><Play className="h-3.5 w-3.5" />{deployLabel}</>
            )}
          </button>
          <p className="text-xs text-muted-foreground text-center">
            {deployed
              ? "Picks deployed — hit Save Lineup to confirm"
              : "Other buckets unchanged. Save lineup to confirm."}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Mode sub-components ───────────────────────────────────────────────────────

function RandomMode({ byBucket, setSelections, isLocked, onDeploy }: Omit<PicksHelperProps, "tournamentPickCounts" | "selections"> & { onDeploy: () => void }) {
  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const [targetBuckets, setTargetBuckets] = useState<Set<number>>(new Set(buckets));
  const [suggestions, setSuggestions] = useState<Record<number, string> | null>(null);
  const [deployed, setDeployed] = useState(false);
  const allActive = buckets.every((b) => targetBuckets.has(b));

  function toggleAll() { setTargetBuckets(allActive ? new Set() : new Set(buckets)); setSuggestions(null); }
  function toggleBucket(b: number) {
    setTargetBuckets((prev) => { const next = new Set(prev); next.has(b) ? next.delete(b) : next.add(b); return next; });
    setSuggestions(null);
  }
  function pickRandom(pool: Golfer[]) { return pool[Math.floor(Math.random() * pool.length)].id; }

  function generate() {
    const result: Record<number, string> = {};
    for (const b of buckets) {
      if (!targetBuckets.has(b)) continue;
      const pool = byBucket[b] ?? [];
      if (pool.length === 0) continue;
      result[b] = pickRandom(pool);
    }
    setSuggestions(result);
    setDeployed(false);
  }

  function rerollBucket(b: number) {
    const pool = byBucket[b] ?? [];
    if (pool.length === 0) return;
    setSuggestions((prev) => ({ ...(prev ?? {}), [b]: pickRandom(pool) }));
  }

  return (
    <HelperPanel
      buckets={buckets} byBucket={byBucket} targetBuckets={targetBuckets}
      toggleAll={toggleAll} toggleBucket={toggleBucket} allActive={allActive}
      suggestions={suggestions} setSuggestions={setSuggestions}
      deployed={deployed} setDeployed={setDeployed}
      onGenerate={generate} onRerollBucket={rerollBucket}
      isLocked={isLocked} setSelections={setSelections}
      generateLabel="Suggest picks"
      generateIcon={<Shuffle className="h-3.5 w-3.5" />}
      onDeploy={onDeploy}
    />
  );
}

function TopRankedMode({ byBucket, setSelections, isLocked, onDeploy }: Omit<PicksHelperProps, "tournamentPickCounts" | "selections"> & { onDeploy: () => void }) {
  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const [targetBuckets, setTargetBuckets] = useState<Set<number>>(new Set(buckets));
  const [suggestions, setSuggestions] = useState<Record<number, string> | null>(null);
  const [deployed, setDeployed] = useState(false);
  const allActive = buckets.every((b) => targetBuckets.has(b));

  function toggleAll() { setTargetBuckets(allActive ? new Set() : new Set(buckets)); setSuggestions(null); }
  function toggleBucket(b: number) {
    setTargetBuckets((prev) => { const next = new Set(prev); next.has(b) ? next.delete(b) : next.add(b); return next; });
    setSuggestions(null);
  }

  function generate() {
    const result: Record<number, string> = {};
    for (const b of buckets) {
      if (!targetBuckets.has(b)) continue;
      const pool = byBucket[b] ?? [];
      if (pool.length === 0) continue;
      // Already sorted ascending by owgr_rank in byBucket — pick index 0
      const best = pool.find((g) => g.owgr_rank != null) ?? pool[0];
      result[b] = best.id;
    }
    setSuggestions(result);
    setDeployed(false);
  }

  return (
    <HelperPanel
      buckets={buckets} byBucket={byBucket} targetBuckets={targetBuckets}
      toggleAll={toggleAll} toggleBucket={toggleBucket} allActive={allActive}
      suggestions={suggestions} setSuggestions={setSuggestions}
      deployed={deployed} setDeployed={setDeployed}
      onGenerate={generate} onRerollBucket={undefined}
      isLocked={isLocked} setSelections={setSelections}
      generateLabel="Apply top-ranked"
      generateIcon={<Play className="h-3.5 w-3.5" />}
      onDeploy={onDeploy}
    />
  );
}

function ContrarianMode({ byBucket, setSelections, isLocked, tournamentPickCounts, onDeploy }: Omit<PicksHelperProps, "selections"> & { onDeploy: () => void }) {
  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const [targetBuckets, setTargetBuckets] = useState<Set<number>>(new Set(buckets));
  const [suggestions, setSuggestions] = useState<Record<number, string> | null>(null);
  const [deployed, setDeployed] = useState(false);
  const allActive = buckets.every((b) => targetBuckets.has(b));

  function toggleAll() { setTargetBuckets(allActive ? new Set() : new Set(buckets)); setSuggestions(null); }
  function toggleBucket(b: number) {
    setTargetBuckets((prev) => { const next = new Set(prev); next.has(b) ? next.delete(b) : next.add(b); return next; });
    setSuggestions(null);
  }

  function leastPickedRandom(pool: Golfer[]): string {
    // Find the minimum pick count across the pool
    const minCount = Math.min(...pool.map((g) => tournamentPickCounts[g.id] ?? 0));
    const leastPicked = pool.filter((g) => (tournamentPickCounts[g.id] ?? 0) === minCount);
    return leastPicked[Math.floor(Math.random() * leastPicked.length)].id;
  }

  function generate() {
    const result: Record<number, string> = {};
    for (const b of buckets) {
      if (!targetBuckets.has(b)) continue;
      const pool = byBucket[b] ?? [];
      if (pool.length === 0) continue;
      result[b] = leastPickedRandom(pool);
    }
    setSuggestions(result);
    setDeployed(false);
  }

  function rerollBucket(b: number) {
    const pool = byBucket[b] ?? [];
    if (pool.length === 0) return;
    setSuggestions((prev) => ({ ...(prev ?? {}), [b]: leastPickedRandom(pool) }));
  }

  return (
    <HelperPanel
      buckets={buckets} byBucket={byBucket} targetBuckets={targetBuckets}
      toggleAll={toggleAll} toggleBucket={toggleBucket} allActive={allActive}
      suggestions={suggestions} setSuggestions={setSuggestions}
      deployed={deployed} setDeployed={setDeployed}
      onGenerate={generate} onRerollBucket={rerollBucket}
      isLocked={isLocked} setSelections={setSelections}
      generateLabel="Find contrarians"
      generateIcon={<Shuffle className="h-3.5 w-3.5" />}
      onDeploy={onDeploy}
    />
  );
}

// ── Shared helper for deterministic historical modes ─────────────────────────

function bestByBucketFromHistory(
  buckets: number[],
  byBucket: Record<number, Golfer[]>,
  historical: HistoricalBestByGolfer,
  targetBuckets: Set<number>
): Record<number, string> {
  const result: Record<number, string> = {};
  for (const b of buckets) {
    if (!targetBuckets.has(b)) continue;
    // Use CURRENT bucket assignment (byBucket) — not the historical bucket.
    const pool = byBucket[b] ?? [];
    // Only golfers in this bucket who have historical data
    const candidates = pool.filter((g) => historical[g.id] != null);
    if (candidates.length === 0) continue;
    // Find the best (lowest) points among candidates
    const bestPoints = Math.min(...candidates.map((g) => historical[g.id]!.points));
    // Collect all tied golfers at that points value
    const tied = candidates.filter((g) => historical[g.id]!.points === bestPoints);
    // Randomise among ties
    result[b] = tied[Math.floor(Math.random() * tied.length)].id;
  }
  return result;
}

function HistoricalMode({
  byBucket, setSelections, isLocked, onDeploy,
  historical, modeLabel, noDataLabel,
}: {
  byBucket: Record<number, Golfer[]>;
  setSelections: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  isLocked: boolean;
  onDeploy: () => void;
  historical: HistoricalBestByGolfer;
  modeLabel: string;
  noDataLabel: string;
}) {
  const buckets = [1, 2, 3, 4, 5, 6, 7];
  const [targetBuckets, setTargetBuckets] = useState<Set<number>>(new Set(buckets));
  const [suggestions, setSuggestions] = useState<Record<number, string> | null>(null);
  const [deployed, setDeployed] = useState(false);
  const allActive = buckets.every((b) => targetBuckets.has(b));

  function toggleAll() { setTargetBuckets(allActive ? new Set() : new Set(buckets)); setSuggestions(null); }
  function toggleBucket(b: number) {
    setTargetBuckets((prev) => { const next = new Set(prev); next.has(b) ? next.delete(b) : next.add(b); return next; });
    setSuggestions(null);
  }

  function generate() {
    const result = bestByBucketFromHistory(buckets, byBucket, historical, targetBuckets);
    setSuggestions(result);
    setDeployed(false);
  }

  // How many of the historical keys are known — shown as context after loading
  const dataCount = Object.values(byBucket).flat().filter((g) => historical[g.id] != null).length;
  const totalCount = Object.values(byBucket).flat().length;

  return (
    <>
      {/* Data availability indicator */}
      <div className="px-5 pt-3 pb-0">
        {totalCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {dataCount === 0
              ? noDataLabel
              : `Historical data available for ${dataCount} of ${totalCount} golfers in this field.`}
          </p>
        )}
      </div>
      <HelperPanel
        buckets={buckets} byBucket={byBucket} targetBuckets={targetBuckets}
        toggleAll={toggleAll} toggleBucket={toggleBucket} allActive={allActive}
        suggestions={suggestions} setSuggestions={setSuggestions}
        deployed={deployed} setDeployed={setDeployed}
        onGenerate={generate} onRerollBucket={undefined}
        isLocked={isLocked}
        setSelections={setSelections}
        generateLabel={modeLabel}
        generateIcon={<Play className="h-3.5 w-3.5" />}
        onDeploy={onDeploy}
        historicalData={historical}
      />
    </>
  );
}

// ── Main PicksHelper shell ────────────────────────────────────────────────────

function PicksHelper({ byBucket, selections, setSelections, isLocked, tournamentPickCounts, onDeploy, lastMajorBest, sameTournamentBest, currentTournamentName }: PicksHelperProps) {
  const [activeMode, setActiveMode] = useState<HelperMode>("random");

  const liveModes: { id: HelperMode; label: string; emoji: string; desc: string }[] = [
    { id: "random",          label: "Random",                emoji: "🎲", desc: "Random golfer per bucket" },
    { id: "top-ranked",      label: "Top ranked",            emoji: "🏆", desc: "Highest OWGR in each bucket" },
    { id: "contrarian",      label: "Contrarian",            emoji: "📉", desc: "Least-picked across all teams" },
    { id: "last-major",      label: "Last major",   emoji: "⚡", desc: "Best finish in most recent major" },
    { id: "same-tournament", label: "Prior year",    emoji: "📅", desc: `Best finish in prior ${currentTournamentName}` },
  ];

  const comingSoon = [
    { label: "🔥 OWGR", desc: "Form-weighted by recent ranking" },
    { label: "Lefties",   desc: "Left-handed golfers only" },
    { label: "Debutants", desc: "First major appearance" },
    { label: "No Yanks",  desc: "Exclude US players" },
    { label: "Fit WAGs",  desc: "Aesthetic-adjacent selection criteria" },
    { label: "C@nts",     desc: "You know who they are" },
  ];

  const activeDesc = liveModes.find((m) => m.id === activeMode)?.desc ?? "";

  return (
    <Card className="p-0 overflow-hidden">
      {/* Panel header */}
      <div className="px-5 pt-4 pb-4 border-b border-border">
        <p
          className="text-[10px] font-bold uppercase tracking-widest mb-2"
          style={{ color: "var(--gold)" }}
        >
          Picks Helper
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Need help? Let the Picks Helper do the heavy lifting! Use the helper options to get smart golfer recommendations for any bucket. Give the picks a quick look, deploy them to your lineup, and you're ready to conquer the Major!
        </p>
      </div>

      {/* Mode selector — chip grid */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Choose a helper
        </p>
        <div className="flex flex-wrap gap-2">
          {liveModes.map((m) => {
            const isActive = activeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveMode(m.id)}
                title={m.desc}
                className={[
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  isActive
                    ? "text-white border-transparent shadow-sm"
                    : "border-border text-foreground hover:border-foreground/30 hover:bg-muted/40",
                ].join(" ")}
                style={isActive ? { backgroundColor: "var(--forest-deep)", borderColor: "var(--forest-deep)" } : {}}
              >
                <span>{m.emoji}</span>
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Coming-soon options — second row */}
        <div className="flex flex-wrap gap-2 mt-2">
          {comingSoon.map((m) => (
            <button
              key={m.label}
              disabled
              title={`Coming soon: ${m.desc}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-border text-muted-foreground/50 cursor-not-allowed opacity-60"
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Active mode description */}
        <p className="mt-3 text-xs text-muted-foreground">{activeDesc}</p>
      </div>

      {/* Active mode content */}
      {activeMode === "random" && (
        <RandomMode byBucket={byBucket} setSelections={setSelections} isLocked={isLocked} onDeploy={onDeploy} />
      )}
      {activeMode === "top-ranked" && (
        <TopRankedMode byBucket={byBucket} setSelections={setSelections} isLocked={isLocked} onDeploy={onDeploy} />
      )}
      {activeMode === "contrarian" && (
        <ContrarianMode
          byBucket={byBucket} setSelections={setSelections}
          isLocked={isLocked} tournamentPickCounts={tournamentPickCounts}
          onDeploy={onDeploy}
        />
      )}
      {activeMode === "last-major" && (
        <HistoricalMode
          byBucket={byBucket} setSelections={setSelections}
          isLocked={isLocked} onDeploy={onDeploy}
          historical={lastMajorBest}
          modeLabel="Apply last major picks"
          noDataLabel="No historical data found for golfers in this field."
        />
      )}
      {activeMode === "same-tournament" && (
        <HistoricalMode
          byBucket={byBucket} setSelections={setSelections}
          isLocked={isLocked} onDeploy={onDeploy}
          historical={sameTournamentBest}
          modeLabel={`Apply ${currentTournamentName} picks`}
          noDataLabel={`No prior ${currentTournamentName} results found for golfers in this field.`}
        />
      )}
    </Card>
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

  // All picks across all teams for this tournament — used by Contrarian helper
  const { data: allTournamentPicks = [] } = useQuery({
    queryKey: ["all-picks", id],
    queryFn: async () => {
      let all: any[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("picks")
          .select("golfer_id")
          .eq("tournament_id", id)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data ?? []);
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  // Historical tournament_score_picks for the current field only.
  // Approach: two flat queries joined client-side to avoid PostgREST nested join ambiguity.
  // Query 1: tournament_scores — get id → tournament_id mapping for all completed tournaments.
  // Query 2: tournament_score_picks — get golfer results filtered to current field golfers.
  // Join client-side: picks.tournament_score_id → scores.id → scores.tournament_id → tournament metadata.
  const fieldGolferIds = field.map((g) => g.id);

  const { data: allTournamentScores = [] } = useQuery({
    queryKey: ["tournament-scores-map"],
    queryFn: async () => {
      let all: any[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("tournament_scores")
          .select("id, tournament_id")
          .range(from, from + PAGE - 1);
        if (error) { console.error("[PicksHelper] tournament_scores error:", error); throw error; }
        all = all.concat(data ?? []);
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      console.log(`[PicksHelper] tournament_scores loaded: ${all.length} rows, sample:`, all[0]);
      return all as { id: string; tournament_id: string }[];
    },
  });

  const { data: allTournaments = [] } = useQuery({
    queryKey: ["tournaments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, start_date")
        .eq("status", "completed");
      if (error) { console.error("[PicksHelper] tournaments error:", error); throw error; }
      console.log(`[PicksHelper] tournaments loaded: ${data?.length} rows`);
      return data as { id: string; name: string; start_date: string }[];
    },
  });

  const { data: historicalScorePicks = [] } = useQuery({
    queryKey: ["historical-score-picks", id, fieldGolferIds.join(",")],
    enabled: fieldGolferIds.length > 0,
    queryFn: async () => {
      let all: any[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("tournament_score_picks")
          .select("golfer_id, points, tournament_score_id")
          .eq("status_type", "STATUS_FINISH")
          .in("golfer_id", fieldGolferIds)
          .range(from, from + PAGE - 1);
        if (error) { console.error("[PicksHelper] tournament_score_picks error:", error); throw error; }
        all = all.concat(data ?? []);
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      console.log(`[PicksHelper] tournament_score_picks loaded: ${all.length} rows, sample:`, all[0]);
      return all as { golfer_id: string; points: number; tournament_score_id: string }[];
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
  const [helperDeployed, setHelperDeployed] = useState(false);

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

  // Aggregate pick counts per golfer across all teams (for Contrarian mode)
  const tournamentPickCounts: Record<string, number> = {};
  for (const p of allTournamentPicks) {
    if (p.golfer_id) tournamentPickCounts[p.golfer_id] = (tournamentPickCounts[p.golfer_id] ?? 0) + 1;
  }

  // Short major name for Same Tournament chip label
  const shortMajorName = (name: string) => {
    if (name.includes("Masters")) return "Masters";
    if (name.includes("PGA Championship")) return "PGA";
    if (name.includes("U.S. Open") || name.includes("US Open")) return "US Open";
    if (name.includes("Open Championship") || name.includes("The Open")) return "The Open";
    return name;
  };
  const currentTournamentName = tournament ? shortMajorName(tournament.name) : "";

  // Build historical maps from tournament_score_picks.
  // Rules:
  // 1. Only golfers in the current field are considered (query already filtered).
  // 2. Current bucket assignment (byBucket) is authoritative — not the historical bucket.
  // 3. For each mode, find each golfer's finish in the relevant tournament,
  //    lowest points = best finish. Ties resolved randomly at the bucket level.
  //
  // "Last Major"    = golfer's finish in the single most recently completed major (by start_date
  //                   from the tournaments table, not inferred from picks data).
  // "Prior Year"    = golfer's finish in the most recent prior edition of THIS tournament.

  // Client-side join: tournament_score_picks → tournament_scores → tournaments
  const scoreIdToTournamentId = new Map<string, string>(
    allTournamentScores.map((s) => [s.id, s.tournament_id])
  );
  const tournamentIdToMeta = new Map<string, { name: string; start_date: string }>(
    allTournaments.map((t) => [t.id, { name: t.name, start_date: t.start_date }])
  );

  type RawHistRow = {
    golferId: string;
    points: number;
    tournamentName: string;
    startDate: string;
    year: number;
    tournamentId: string;
  };

  const rawRows: RawHistRow[] = [];
  for (const row of historicalScorePicks) {
    const tournamentId = scoreIdToTournamentId.get(row.tournament_score_id);
    if (!tournamentId || tournamentId === id) continue; // skip current tournament
    const meta = tournamentIdToMeta.get(tournamentId);
    if (!meta?.start_date || !meta?.name) continue;
    rawRows.push({
      golferId: row.golfer_id,
      points: row.points,
      tournamentName: shortMajorName(meta.name),
      startDate: meta.start_date,
      year: new Date(meta.start_date).getFullYear(),
      tournamentId,
    });
  }
  console.log(`[PicksHelper] rawRows after join: ${rawRows.length}, sample:`, rawRows[0]);

  // Determine the most recent completed tournament from the tournaments table directly —
  // authoritative source, not inferred from which golfers happened to have picks data.
  const completedPriorTournaments = allTournaments
    .filter((t) => t.id !== id && t.start_date < (tournament?.start_date ?? "9999"))
    .sort((a, b) => b.start_date.localeCompare(a.start_date)); // descending

  const lastMajorTournamentId = completedPriorTournaments[0]?.id ?? null;

  // Most recent prior edition of THIS tournament by name
  const priorSameTournaments = completedPriorTournaments
    .filter((t) => shortMajorName(t.name) === currentTournamentName);
  const priorYearTournamentId = priorSameTournaments[0]?.id ?? null;

  // Last Major: per golfer, take their result from lastMajorTournamentId only.
  // A golfer can appear multiple times (picked by multiple teams) — keep lowest points.
  const lastMajorByGolfer: HistoricalBestByGolfer = {};
  if (lastMajorTournamentId) {
    for (const r of rawRows.filter((r) => r.tournamentId === lastMajorTournamentId)) {
      const existing = lastMajorByGolfer[r.golferId];
      if (!existing || r.points < existing.points) {
        lastMajorByGolfer[r.golferId] = { points: r.points, tournamentName: r.tournamentName, year: r.year };
      }
    }
  }
  console.log(`[PicksHelper] lastMajor tournamentId=${lastMajorTournamentId}, matches=${Object.keys(lastMajorByGolfer).length} field golfers`);

  // Prior Year: per golfer, take their result from priorYearTournamentId only.
  const sameTournamentByGolfer: HistoricalBestByGolfer = {};
  if (priorYearTournamentId) {
    for (const r of rawRows.filter((r) => r.tournamentId === priorYearTournamentId)) {
      const existing = sameTournamentByGolfer[r.golferId];
      if (!existing || r.points < existing.points) {
        sameTournamentByGolfer[r.golferId] = { points: r.points, tournamentName: r.tournamentName, year: r.year };
      }
    }
  }
  console.log(`[PicksHelper] priorYear tournamentId=${priorYearTournamentId}, matches=${Object.keys(sameTournamentByGolfer).length} field golfers`);

  const lastMajorBest: HistoricalBestByGolfer = lastMajorByGolfer;
  const sameTournamentBest: HistoricalBestByGolfer = sameTournamentByGolfer;

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
          onClick={() => { save(); setHelperDeployed(false); }}
          disabled={!impersonatingId && isLocked}
          className={[
            "w-full py-4 font-display text-xs uppercase tracking-widest text-white disabled:opacity-50 transition-colors",
            helperDeployed
              ? "bg-red-600"
              : hasSubmission && changedCount === 0
              ? "bg-green-600"
              : "",
          ].join(" ")}
          style={!helperDeployed && !(hasSubmission && changedCount === 0) ? { backgroundColor: "var(--forest-deep)" } : {}}
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
      tournamentPickCounts={tournamentPickCounts}
      onDeploy={() => setHelperDeployed(true)}
      lastMajorBest={lastMajorBest}
      sameTournamentBest={sameTournamentBest}
      currentTournamentName={currentTournamentName}
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
      <div className="lg:hidden p-4 md:p-12 max-w-4xl pb-16 md:pb-16">
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
          {/* Left: picks card — scrollable, content anchored to top */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col">
              {picksCard}
            </div>
          </div>

          {/* Right: picks helper — scrollable, content anchored to top */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col">
              {helperBlock}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
