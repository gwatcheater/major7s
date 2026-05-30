import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Trash2,
  Undo2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";

type Props = { tournamentId: string; tournamentName: string; bucketSizes?: Record<number, number> };

type ParsedRow = { line: number; raw: string; name: string; owgr: number };
type LineError = { line: number; raw: string; reason: string };
type ParseResult = { rows: ParsedRow[]; errors: LineError[] };

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;

const BUCKET_COLORS: Record<number, string> = {
  1: "bg-green-700 text-white",
  2: "bg-amber-500 text-black",
  3: "bg-blue-700 text-white",
  4: "bg-rose-500 text-white",
  5: "bg-violet-700 text-white",
  6: "bg-orange-600 text-white",
  7: "bg-slate-600 text-white",
};

export function parseFieldCsv(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: LineError[] = [];
  const lines = text.split(/\r?\n/);
  const nameOccurrences = new Map<string, number[]>();

  const cleaned: Array<{ line: number; raw: string; parts: string[] } | null> = lines.map(
    (raw, idx) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      return {
        line: idx + 1,
        raw: trimmed,
        parts: trimmed.split(",").map((p) => p.trim()),
      };
    },
  );

  // First pass: structural + per-field validation; collect duplicate names.
  const provisional: Array<{ row: ParsedRow | null; error: LineError | null }> = [];

  for (const item of cleaned) {
    if (!item) {
      provisional.push({ row: null, error: null });
      continue;
    }
    const { line, raw, parts } = item;

    if (parts.length !== 2) {
      provisional.push({
        row: null,
        error: { line, raw, reason: `Expected 2 comma-separated fields, got ${parts.length}` },
      });
      continue;
    }
    const [name, owgrStr] = parts;
    if (!name) {
      provisional.push({ row: null, error: { line, raw, reason: "Name is required" } });
      continue;
    }
    const owgr = Number(owgrStr);
    if (!Number.isInteger(owgr) || owgr < 1) {
      provisional.push({
        row: null,
        error: { line, raw, reason: "OWGR must be a positive integer" },
      });
      continue;
    }

    const key = name.toLowerCase();
    const arr = nameOccurrences.get(key) ?? [];
    arr.push(line);
    nameOccurrences.set(key, arr);

    provisional.push({ row: { line, raw, name, owgr }, error: null });
  }

  // Second pass: convert duplicates into errors.
  const duplicateLines = new Set<number>();
  for (const arr of nameOccurrences.values()) {
    if (arr.length > 1) for (const ln of arr) duplicateLines.add(ln);
  }

  for (const p of provisional) {
    if (p.error) {
      errors.push(p.error);
    } else if (p.row) {
      if (duplicateLines.has(p.row.line)) {
        errors.push({ line: p.row.line, raw: p.row.raw, reason: "Duplicate name in batch" });
      } else {
        rows.push(p.row);
      }
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}

function purgeToken(name: string): string {
  const slug = (name || "TOURNAMENT")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `PURGE_${slug || "TOURNAMENT"}`;
}

const DEFAULT_BUCKET_SIZES: Record<number, number> = {
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  5: 0,
  6: 0,
  7: 0,
};

function assignBuckets(
  newRows: ParsedRow[],
  existingCounts: Record<number, number>,
  bucketSizes: Record<number, number>,
): Array<ParsedRow & { bucket: number }> {
  const sorted = [...newRows].sort((a, b) => a.owgr - b.owgr);
  const capacity: Record<number, number> = {};
  for (const b of BUCKETS) {
    capacity[b] = Math.max(0, (bucketSizes[b] ?? 0) - (existingCounts[b] ?? 0));
  }
  return sorted.map((row) => {
    let bucket = 7;
    for (const b of BUCKETS) {
      if (capacity[b] > 0) {
        bucket = b;
        capacity[b]--;
        break;
      }
    }
    return { ...row, bucket };
  });
}

export function AdvancedFieldPortal({
  tournamentId,
  tournamentName,
  bucketSizes: bucketSizesProp,
}: Props) {
  const qc = useQueryClient();
  const [bulkText, setBulkText] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: golfers = [] } = useQuery({
    queryKey: ["admin-field-golfers", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name, owgr_rank, bucket_number")
        .eq("tournament_id", tournamentId)
        .order("bucket_number", { ascending: true })
        .order("owgr_rank", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sizes = useMemo(() => {
    const out: Record<number, number> = { ...DEFAULT_BUCKET_SIZES };
    if (bucketSizesProp && typeof bucketSizesProp === "object") {
      for (const b of BUCKETS) {
        const v = Number(bucketSizesProp[b] ?? 0);
        if (Number.isFinite(v) && v >= 0) out[b] = Math.floor(v);
      }
    }
    return out;
  }, [bucketSizesProp]);

  const existingCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const g of golfers) c[g.bucket_number] = (c[g.bucket_number] ?? 0) + 1;
    return c;
  }, [golfers]);

  const totalCapacity = useMemo(() => BUCKETS.reduce((sum, b) => sum + sizes[b], 0), [sizes]);
  const totalExisting = golfers.length;
  const remainingCapacity = Math.max(0, totalCapacity - totalExisting);

  const parsed = useMemo(() => parseFieldCsv(bulkText), [bulkText]);
  const errorLineSet = useMemo(() => new Set(parsed.errors.map((e) => e.line)), [parsed]);
  const validLineSet = useMemo(() => new Set(parsed.rows.map((r) => r.line)), [parsed]);

  const totalNonEmpty = parsed.rows.length + parsed.errors.length;
  const canUpload = !uploading && parsed.errors.length === 0 && parsed.rows.length > 0;

  async function handleUpload() {
    if (!canUpload) return;
    setUploading(true);
    const assigned = assignBuckets(parsed.rows, existingCounts, sizes);
    const payload = assigned.map((r) => ({
      tournament_id: tournamentId,
      golfer_name: r.name,
      owgr_rank: r.owgr,
      bucket_number: r.bucket,
    }));
    const { error } = await supabase.from("golfers").insert(payload);
    setUploading(false);
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    toast.success(`${payload.length} golfer${payload.length === 1 ? "" : "s"} added`);
    setBulkText("");
    qc.invalidateQueries({ queryKey: ["admin-field-golfers", tournamentId] });
    qc.invalidateQueries({ queryKey: ["field", tournamentId] });
  }

  async function removeGolfer(rowId: string, name: string) {
    if (!confirm(`Remove ${name} from the field?`)) return;
    const { error } = await supabase.from("golfers").delete().eq("id", rowId);
    if (error) toast.error(error.message);
    else {
      toast.success(`Removed ${name}`);
      qc.invalidateQueries({ queryKey: ["admin-field-golfers", tournamentId] });
      qc.invalidateQueries({ queryKey: ["field", tournamentId] });
    }
  }

  const linesPreview = useMemo(() => {
    return bulkText.split(/\r?\n/).map((raw, idx) => ({
      line: idx + 1,
      raw,
      trimmed: raw.trim(),
    }));
  }, [bulkText]);

  const errorByLine = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of parsed.errors) m.set(e.line, e.reason);
    return m;
  }, [parsed]);

  const counts = existingCounts;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-md grid place-items-center bg-primary/10">
          <Upload className="size-4 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg uppercase tracking-tight leading-none">
            Advanced Field Portal
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Bulk roster ingestion with line-by-line validation and safeguarded purge.
          </p>
        </div>
      </div>

      {/* Help panel */}
      <Alert>
        <FileText className="size-4" />
        <AlertTitle>CSV format</AlertTitle>
        <AlertDescription>
          <div className="space-y-3 mt-2">
            <p className="text-xs">
              One golfer per line. Two comma-separated fields, in this exact order:
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
              Name, OWGR Ranking
            </pre>
            <p className="text-xs">
              Buckets are assigned automatically by OWGR ranking (lowest fills Bucket 1 first, then
              B2, B3, etc.) using the configured bucket sizes.
            </p>
            <p className="text-xs">Valid sample:</p>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
              {`Scottie Scheffler, 1
Rory McIlroy, 2
Ludvig Aberg, 5`}
            </pre>
            <ul className="text-xs list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Exactly 2 fields per row — extra commas in the name will break the row.</li>
              <li>Name is required and cannot be blank.</li>
              <li>OWGR must be a positive integer.</li>
              <li>Bucket assignment is automatic based on OWGR and configured bucket sizes.</li>
              <li>Duplicate names within the same paste are flagged before insert.</li>
            </ul>
          </div>
        </AlertDescription>
      </Alert>

      {/* Upload + metrics grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload + log (spans 2) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-border bg-card rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-display text-sm uppercase tracking-widest">Bulk paste</h3>
              <div className="text-[11px] font-mono text-muted-foreground">
                <span className="text-emerald-600">{parsed.rows.length} valid</span>
                {" · "}
                <span className="text-destructive">{parsed.errors.length} errors</span>
                {" · "}
                <span>{totalNonEmpty} total</span>
              </div>
            </div>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Scottie Scheffler, 1\nRory McIlroy, 2\nXander Schauffele, 3"}
              className="min-h-[240px] font-mono text-sm"
            />
            {parsed.rows.length > 0 && parsed.rows.length > remainingCapacity && (
              <p className="text-xs text-amber-600">
                {remainingCapacity === 0
                  ? "All buckets are full. Overflow golfers will be placed in B7."
                  : `Only ${remainingCapacity} bucket slot${remainingCapacity === 1 ? "" : "s"} remaining. ${parsed.rows.length - remainingCapacity} golfer${parsed.rows.length - remainingCapacity === 1 ? "" : "s"} will overflow to B7.`}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleUpload} disabled={!canUpload}>
                <Upload className="size-4" />
                {uploading
                  ? "Uploading…"
                  : `Upload ${parsed.rows.length || ""} golfer${parsed.rows.length === 1 ? "" : "s"}`}
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkText("")}
                disabled={uploading || !bulkText}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Validation log */}
          <div className="border border-border bg-card rounded-md">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-display text-sm uppercase tracking-widest">Validation log</h3>
              {parsed.errors.length > 0 && (
                <span className="text-[11px] font-bold uppercase tracking-widest text-destructive">
                  Blocking upload
                </span>
              )}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {linesPreview.filter((l) => l.trimmed).length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">Paste rows to validate.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {linesPreview.map(({ line, raw, trimmed }) => {
                    if (!trimmed) return null;
                    const isErr = errorLineSet.has(line);
                    const isOk = validLineSet.has(line);
                    return (
                      <li
                        key={line}
                        className={`flex items-start gap-3 px-3 py-2 text-xs border-l-4 ${
                          isErr
                            ? "border-l-destructive bg-destructive/5"
                            : isOk
                              ? "border-l-emerald-500 bg-emerald-500/5"
                              : "border-l-transparent"
                        }`}
                      >
                        <span className="font-mono text-muted-foreground w-8 shrink-0 text-right">
                          {line}
                        </span>
                        {isErr ? (
                          <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-mono truncate">{raw}</div>
                          {isErr && (
                            <div className="text-destructive mt-0.5">{errorByLine.get(line)}</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Metrics + list */}
        <div className="space-y-4">
          <div className="border border-border bg-card rounded-md p-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-md grid place-items-center bg-primary/10">
                <Users className="size-5 text-primary" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Total registered
                </div>
                <div className="font-display text-3xl leading-none mt-1">{golfers.length}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {BUCKETS.map((b) => (
                <span
                  key={b}
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${BUCKET_COLORS[b]}`}
                >
                  B{b} · {counts[b] ?? 0}
                </span>
              ))}
            </div>
          </div>

          <div className="border border-border bg-card rounded-md">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-display text-sm uppercase tracking-widest">Active field</h3>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {golfers.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No golfers registered yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {golfers.map((g) => (
                    <li key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <BucketEditor
                        golferId={g.id}
                        golferName={g.golfer_name}
                        currentBucket={g.bucket_number}
                        sizes={sizes}
                        counts={counts}
                        tournamentId={tournamentId}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{g.golfer_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          OWGR #{g.owgr_rank ?? "—"}
                        </div>
                      </div>
                      <button
                        onClick={() => removeGolfer(g.id, g.golfer_name)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                        aria-label={`Remove ${g.golfer_name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <DangerZone tournamentId={tournamentId} tournamentName={tournamentName} />
    </div>
  );
}

function BucketEditor({
  golferId,
  golferName,
  currentBucket,
  sizes,
  counts,
  tournamentId,
}: {
  golferId: string;
  golferName: string;
  currentBucket: number;
  sizes: Record<number, number>;
  counts: Record<number, number>;
  tournamentId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  async function move(toBucket: number) {
    if (toBucket === currentBucket) {
      setOpen(false);
      return;
    }
    // Warn-but-allow capacity check.
    const capacity = sizes[toBucket] ?? 0;
    const existing = counts[toBucket] ?? 0;
    if (capacity > 0 && existing >= capacity) {
      toast.warning(`Bucket ${toBucket} is full (${existing}/${capacity}) — moving anyway`);
    }
    setSaving(true);
    setOpen(false);
    const { error } = await supabase
      .from("golfers")
      .update({ bucket_number: toBucket })
      .eq("id", golferId);
    setSaving(false);
    if (error) {
      toast.error(`Couldn't move ${golferName}: ${error.message}`);
      return;
    }
    toast.success(`${golferName} → Bucket ${toBucket}`);
    qc.invalidateQueries({ queryKey: ["admin-field-golfers", tournamentId] });
    qc.invalidateQueries({ queryKey: ["field", tournamentId] });
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${BUCKET_COLORS[currentBucket] ?? "bg-muted"} hover:opacity-80 disabled:opacity-50`}
        aria-label={`Change bucket for ${golferName}`}
      >
        B{currentBucket}
      </button>
      {open && (
        <div className="absolute z-20 left-0 mt-1 min-w-[140px] rounded-md border border-border bg-popover shadow-md p-1">
          {BUCKETS.map((b) => {
            const capacity = sizes[b] ?? 0;
            const existing = counts[b] ?? 0;
            const isCurrent = b === currentBucket;
            const isFull = capacity > 0 && existing >= capacity;
            return (
              <button
                key={b}
                type="button"
                onClick={() => move(b)}
                className={`w-full flex items-center justify-between gap-2 text-xs px-2 py-1 rounded hover:bg-accent ${
                  isCurrent ? "font-bold" : ""
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${BUCKET_COLORS[b]}`}>
                    B{b}
                  </span>
                  {isCurrent && <span className="text-muted-foreground">current</span>}
                </span>
                <span className={`text-[10px] tabular-nums ${isFull ? "text-amber-600" : "text-muted-foreground"}`}>
                  {existing}/{capacity}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DangerZone({ tournamentId, tournamentName }: Props) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "arming" | "counting" | "purging">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [remaining, setRemaining] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortedRef = useRef(false);

  const token = useMemo(() => purgeToken(tournamentName), [tournamentName]);
  const matches = confirmText === token;

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function beginArm() {
    setConfirmText("");
    setPhase("arming");
  }

  function cancelArm() {
    setConfirmText("");
    setPhase("idle");
  }

  function startCountdown() {
    if (!matches) return;
    abortedRef.current = false;
    setRemaining(5);
    setPhase("counting");
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          if (!abortedRef.current) void executePurge();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  function undoCountdown() {
    abortedRef.current = true;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPhase("idle");
    setConfirmText("");
    toast("Purge cancelled — no data was touched.");
  }

async function executePurge() {
  setPhase("purging");

  // Step 1: delete picks first (FK: picks_golfer_id_fkey)
  const { error: picksError } = await supabase
    .from("picks")
    .delete()
    .eq("tournament_id", tournamentId);

  if (picksError) {
    toast.error(`Purge failed (picks): ${picksError.message}`);
    setConfirmText("");
    setPhase("idle");
    return;
  }

  // Step 2: now safe to delete golfers
  const { error: golfersError } = await supabase
    .from("golfers")
    .delete()
    .eq("tournament_id", tournamentId);

  if (golfersError) {
    toast.error(`Purge failed (golfers): ${golfersError.message}`);
  } else {
    toast.success("Field roster and all picks purged.");
    qc.invalidateQueries({ queryKey: ["admin-field-golfers", tournamentId] });
    qc.invalidateQueries({ queryKey: ["field", tournamentId] });
    qc.invalidateQueries({ queryKey: ["admin-picks-for-tournament", tournamentId] });
  }

  setConfirmText("");
  setPhase("idle");
}


  return (
    <div className="border-2 border-destructive/60 rounded-md bg-destructive/5">
      <div className="px-4 py-3 border-b border-destructive/40 flex items-center gap-2">
        <AlertTriangle className="size-4 text-destructive" />
        <h3 className="font-display text-sm uppercase tracking-widest text-destructive">
          Danger zone
        </h3>
      </div>

      <div className="p-4">
        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm">
              Wipe the entire player roster for{" "}
              <strong>{tournamentName || "this tournament"}</strong>. This deletes every golfer
              registered to this tournament and cannot be undone after the 5-second window.
            </p>
            <Button variant="destructive" onClick={beginArm}>
              <Trash2 className="size-4" />
              Begin field purge
            </Button>
          </div>
        )}

        {phase === "arming" && (
          <div className="space-y-3">
            <p className="text-sm">
              To confirm, type the phrase below exactly into the input. The phrase is generated from
              this tournament's name.
            </p>
            <pre className="rounded-md bg-background border border-destructive/40 px-3 py-2 text-sm font-mono text-destructive overflow-x-auto">
              {token}
            </pre>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={token}
              className="font-mono"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="destructive" onClick={startCountdown} disabled={!matches}>
                <Trash2 className="size-4" />
                Confirm purge
              </Button>
              <Button variant="outline" onClick={cancelArm}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {phase === "counting" && (
          <div className="space-y-3 text-center py-4">
            <AlertTriangle className="size-10 text-destructive mx-auto" />
            <div className="font-display text-4xl text-destructive">Purging in {remaining}s</div>
            <p className="text-sm text-muted-foreground">
              Tap undo to abort. Once the timer hits zero the delete is final.
            </p>
            <Button
              variant="outline"
              size="lg"
              onClick={undoCountdown}
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Undo2 className="size-5" />
              Undo / Stop
            </Button>
          </div>
        )}

        {phase === "purging" && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Purging field roster…
          </div>
        )}
      </div>
    </div>
  );
}
