import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/tournament/$id/field")({
  component: AdminFieldPage,
});

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const BUCKET_LABELS: Record<number, string> = {
  1: "Tier 1", 2: "Tier 2", 3: "Tier 3", 4: "Tier 4",
  5: "Tier 5", 6: "Tier 6", 7: "Tier 7",
};
const DEFAULT_SIZES: Record<number, number> = { 1: 10, 2: 10, 3: 10, 4: 10, 5: 0, 6: 0, 7: 0 };

function normalizeSizes(raw: any): Record<number, number> {
  const out: Record<number, number> = { ...DEFAULT_SIZES };
  if (raw && typeof raw === "object") {
    for (const b of BUCKETS) {
      const v = Number(raw[b] ?? raw[String(b)]);
      if (Number.isFinite(v) && v >= 0) out[b] = Math.floor(v);
    }
  }
  return out;
}

/** Suggest a bucket for a golfer based on their OWGR rank position
 *  inside the cumulative bucket sizes. */
function suggestBucketFromSizes(rank: number | null | undefined, sizes: Record<number, number>): number {
  if (!rank || rank <= 0) return 7;
  let cum = 0;
  for (const b of BUCKETS) {
    cum += sizes[b] ?? 0;
    if (rank <= cum) return b;
  }
  return 7;
}

function AdminFieldPage() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sizeDraft, setSizeDraft] = useState<Record<number, string> | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLog, setBulkLog] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [picksOpen, setPicksOpen] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; course: string; start_date: string; end_date: string; lock_at: string } | null>(null);


  const { data: tournament, refetch: refetchTournament } = useQuery({
    queryKey: ["admin-field-tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const sizes = useMemo(
    () => normalizeSizes((tournament as any)?.bucket_sizes),
    [tournament],
  );

  const { data: golfers = [] } = useQuery({
    queryKey: ["admin-field-golfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, standard_name, owgr_rank, aliases")
        .order("owgr_rank", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  const { data: field = [], refetch } = useQuery({
    queryKey: ["admin-field", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_field")
        .select("id, golfer_id, owgr_bucket")
        .eq("tournament_id", id);
      if (error) throw error;
      return data;
    },
  });

  const { data: allPicks = [], refetch: refetchPicks } = useQuery({
    queryKey: ["admin-tournament-picks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("id, bucket, team_id, golfer_id, submitted_at, team:teams(nickname, owner_user_id, is_primary), golfer:golfers(standard_name)")
        .eq("tournament_id", id)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });


  const fieldMap = useMemo(() => {
    const m = new Map<string, { id: string; bucket: number }>();
    for (const f of field) m.set(f.golfer_id, { id: f.id, bucket: f.owgr_bucket });
    return m;
  }, [field]);

  if (!isAdmin) {
    return (
      <div className="p-12">
        <p className="text-sm text-muted-foreground">Admin only.</p>
        <Link to="/home" className="text-xs uppercase underline">← Back</Link>
      </div>
    );
  }

  async function addToField(golferId: string, rank: number | null) {
    const bucket = suggestBucketFromSizes(rank, sizes);
    const { error } = await supabase.from("tournament_field").insert({
      tournament_id: id, golfer_id: golferId, owgr_bucket: bucket,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added to B${bucket}`);
    refetch(); qc.invalidateQueries({ queryKey: ["field", id] });
  }

  async function removeFromField(rowId: string) {
    const { error } = await supabase.from("tournament_field").delete().eq("id", rowId);
    if (error) toast.error(error.message);
    else { refetch(); qc.invalidateQueries({ queryKey: ["field", id] }); }
  }

  async function setBucket(rowId: string, bucket: number) {
    const { error } = await supabase.from("tournament_field").update({ owgr_bucket: bucket }).eq("id", rowId);
    if (error) toast.error(error.message);
    else { refetch(); qc.invalidateQueries({ queryKey: ["field", id] }); }
  }

  /** Re-distribute every golfer currently in the field into buckets,
   *  sorted by OWGR ascending and filling B1..B7 by configured sizes. */
  async function autoAssignAll() {
    if (field.length === 0) { toast.error("No golfers in field yet"); return; }

    const rows = field
      .map((f) => {
        const g = golfers.find((x: any) => x.id === f.golfer_id);
        return { id: f.id, rank: g?.owgr_rank ?? null };
      })
      .sort((a, b) => {
        const ar = a.rank ?? 1e9;
        const br = b.rank ?? 1e9;
        return ar - br;
      });

    // Walk in OWGR order, dropping each golfer into the next bucket whose
    // capacity isn't full. Overflow goes into bucket 7.
    const capacity: Record<number, number> = { ...sizes };
    const updates: Array<{ id: string; bucket: number }> = [];
    let cursor = 1;
    for (const r of rows) {
      while (cursor <= 7 && (capacity[cursor] ?? 0) <= 0) cursor++;
      const bucket = cursor <= 7 ? cursor : 7;
      capacity[bucket] = (capacity[bucket] ?? 0) - 1;
      updates.push({ id: r.id, bucket });
    }

    const results = await Promise.all(
      updates.map((u) =>
        supabase.from("tournament_field").update({ owgr_bucket: u.bucket }).eq("id", u.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) { toast.error(failed.error.message); return; }

    toast.success(`Auto-assigned ${updates.length} golfers`);
    refetch(); qc.invalidateQueries({ queryKey: ["field", id] });
  }

  async function saveSizes() {
    if (!sizeDraft) return;
    const next: Record<number, number> = {};
    for (const b of BUCKETS) {
      const v = parseInt(sizeDraft[b] ?? "0", 10);
      next[b] = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    const { error } = await supabase
      .from("tournaments")
      .update({ bucket_sizes: next as any })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Bucket sizes saved");
    setSizeDraft(null);
    refetchTournament();
  }

  function openDetails() {
    if (!tournament) return;
    const lockLocal = (() => {
      const d = new Date((tournament as any).lock_at);
      const tz = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tz).toISOString().slice(0, 16);
    })();
    setDetailsDraft({
      name: (tournament as any).name ?? "",
      course: (tournament as any).course ?? "",
      start_date: (tournament as any).start_date ?? "",
      end_date: (tournament as any).end_date ?? "",
      lock_at: lockLocal,
    });
    setDetailsOpen(true);
  }

  async function saveDetails() {
    if (!detailsDraft) return;
    const { name, course, start_date, end_date, lock_at } = detailsDraft;
    if (!name || !course || !start_date || !end_date || !lock_at) {
      toast.error("All fields required"); return;
    }
    const { error } = await supabase
      .from("tournaments")
      .update({ name, course, start_date, end_date, lock_at: new Date(lock_at).toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Tournament updated");
    setDetailsDraft(null);
    refetchTournament();
    qc.invalidateQueries({ queryKey: ["tournaments-active"] });
    qc.invalidateQueries({ queryKey: ["admin-tournaments"] });
  }

  async function deletePick(pickId: string) {
    if (!confirm("Delete this pick?")) return;
    const { error } = await supabase.from("picks").delete().eq("id", pickId);
    if (error) { toast.error(error.message); return; }
    toast.success("Pick deleted");
    refetchPicks();
    qc.invalidateQueries({ queryKey: ["picks"] });
  }



  function normalize(s: string) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  async function runBulkUpload() {
    const lines = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("Paste at least one row"); return; }
    setBulkBusy(true);
    const log: string[] = [];

    // Build lookup: normalized name -> golfer
    const lookup = new Map<string, any>();
    for (const g of golfers as any[]) {
      lookup.set(normalize(g.standard_name), g);
      const aliases = Array.isArray(g.aliases) ? g.aliases : [];
      for (const a of aliases) if (typeof a === "string") lookup.set(normalize(a), g);
    }

    const inserts: Array<{ tournament_id: string; golfer_id: string; owgr_bucket: number }> = [];
    const updates: Array<{ id: string; bucket: number }> = [];
    let skipped = 0;

    for (const line of lines) {
      // split on tab or comma; bucket is the last numeric token
      const parts = line.split(/[\t,]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) { log.push(`SKIP "${line}" — need name + bucket`); skipped++; continue; }
      const bucketStr = parts[parts.length - 1];
      const bucket = parseInt(bucketStr, 10);
      if (!Number.isFinite(bucket) || bucket < 1 || bucket > 7) {
        log.push(`SKIP "${line}" — bucket must be 1–7`); skipped++; continue;
      }
      const name = parts.slice(0, -1).join(" ");
      const g = lookup.get(normalize(name));
      if (!g) { log.push(`MISS "${name}" — not in golfers table`); skipped++; continue; }
      const existing = fieldMap.get(g.id);
      if (existing) {
        if (existing.bucket !== bucket) updates.push({ id: existing.id, bucket });
        else log.push(`OK   "${g.standard_name}" already in B${bucket}`);
      } else {
        inserts.push({ tournament_id: id, golfer_id: g.id, owgr_bucket: bucket });
      }
    }

    let ok = 0;
    if (inserts.length > 0) {
      const { error, count } = await supabase.from("tournament_field").insert(inserts, { count: "exact" });
      if (error) log.push(`ERROR insert: ${error.message}`);
      else ok += count ?? inserts.length;
    }
    if (updates.length > 0) {
      const res = await Promise.all(
        updates.map((u) => supabase.from("tournament_field").update({ owgr_bucket: u.bucket }).eq("id", u.id)),
      );
      const failed = res.filter((r) => r.error);
      ok += updates.length - failed.length;
      for (const f of failed) if (f.error) log.push(`ERROR update: ${f.error.message}`);
    }

    log.unshift(`Processed ${lines.length} · added/updated ${ok} · skipped ${skipped}`);
    setBulkLog(log);
    setBulkBusy(false);
    toast.success(`Bulk upload: ${ok} applied, ${skipped} skipped`);
    refetch(); qc.invalidateQueries({ queryKey: ["field", id] });
  }



  const q = search.trim().toLowerCase();
  const available = golfers.filter((g: any) =>
    !fieldMap.has(g.id) && (q === "" || g.standard_name.toLowerCase().includes(q))
  );

  const fieldRows = field
    .map((f) => ({ ...f, golfer: golfers.find((g: any) => g.id === f.golfer_id) }))
    .sort((a, b) => a.owgr_bucket - b.owgr_bucket || ((a.golfer?.owgr_rank ?? 999) - (b.golfer?.owgr_rank ?? 999)));

  const counts: Record<number, number> = {};
  for (const f of field) counts[f.owgr_bucket] = (counts[f.owgr_bucket] ?? 0) + 1;

  return (
    <div className="p-8 md:p-12 max-w-6xl">
      <Link to="/admin" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Admin</Link>
      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Field Management</p>
        <h1 className="font-display text-3xl uppercase mt-1">{tournament?.name ?? "Tournament"}</h1>
        <p className="text-sm text-muted-foreground">{tournament?.course}</p>
      </header>

      {/* Tournament details */}
      <div className="mb-6 border border-border bg-card">
        <button onClick={() => setDetailsOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted">
          <span className="font-display text-sm uppercase tracking-widest">Tournament details</span>
          <span className="text-xs text-muted-foreground">{detailsOpen ? "Hide ▲" : "Edit ▼"}</span>
        </button>
        {detailsOpen && (
          <div className="p-4 border-t border-border space-y-3">
            {!detailsDraft ? (
              <button onClick={openDetails} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>Edit</button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Name</label>
                  <input className="w-full px-3 py-2 border border-input bg-white text-sm" value={detailsDraft.name} onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Course</label>
                  <input className="w-full px-3 py-2 border border-input bg-white text-sm" value={detailsDraft.course} onChange={(e) => setDetailsDraft({ ...detailsDraft, course: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Start</label>
                    <input type="date" className="w-full px-3 py-2 border border-input bg-white text-sm" value={detailsDraft.start_date} onChange={(e) => setDetailsDraft({ ...detailsDraft, start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">End</label>
                    <input type="date" className="w-full px-3 py-2 border border-input bg-white text-sm" value={detailsDraft.end_date} onChange={(e) => setDetailsDraft({ ...detailsDraft, end_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Lock cutoff</label>
                  <input type="datetime-local" className="w-full px-3 py-2 border border-input bg-white text-sm" value={detailsDraft.lock_at} onChange={(e) => setDetailsDraft({ ...detailsDraft, lock_at: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveDetails} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>Save</button>
                  <button onClick={() => setDetailsDraft(null)} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* All picks */}
      <div className="mb-6 border border-border bg-card">
        <button onClick={() => setPicksOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted">
          <span className="font-display text-sm uppercase tracking-widest">
            Submitted picks <span className="ml-2 text-xs text-muted-foreground normal-case tracking-normal">({allPicks.length} picks · {new Set(allPicks.map((p: any) => p.team_id)).size} teams)</span>
          </span>
          <span className="text-xs text-muted-foreground">{picksOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {picksOpen && (
          <div className="border-t border-border max-h-[500px] overflow-y-auto">
            {allPicks.length === 0 && <p className="p-4 text-sm text-muted-foreground">No picks submitted yet.</p>}
            {(() => {
              const byTeam: Record<string, any[]> = {};
              for (const p of allPicks as any[]) (byTeam[p.team_id] ??= []).push(p);
              return Object.entries(byTeam).map(([tid, ps]) => (
                <div key={tid} className="border-b border-border p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="font-display text-xs uppercase" style={{ color: "var(--gold)" }}>
                      {ps[0].team?.nickname ?? tid} {ps[0].team?.is_primary && <span className="text-[9px] text-muted-foreground normal-case">(primary)</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{ps.length} picks</div>
                  </div>
                  <div className="space-y-1">
                    {ps.sort((a, b) => a.bucket - b.bucket).map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-muted-foreground">B{p.bucket}</span>
                          <span className="truncate">{p.golfer?.standard_name ?? p.golfer_id}</span>
                        </div>
                        <button onClick={() => deletePick(p.id)} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border border-destructive text-destructive hover:bg-destructive hover:text-white transition-colors">
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>



      {/* Bucket configuration */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-sm uppercase tracking-widest">Bucket sizes</h2>
          {sizeDraft ? (
            <div className="flex gap-2">
              <button onClick={() => setSizeDraft(null)} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted">Cancel</button>
              <button onClick={saveSizes} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>Save sizes</button>
            </div>
          ) : (
            <button
              onClick={() => setSizeDraft(Object.fromEntries(BUCKETS.map((b) => [b, String(sizes[b] ?? 0)])) as Record<number, string>)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted"
            >
              Edit sizes
            </button>
          )}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {BUCKETS.map((b) => {
            const count = counts[b] ?? 0;
            const required = sizes[b] ?? 0;
            const ok = required === 0 ? true : count === required;
            return (
              <div
                key={b}
                className="bg-card border p-3 text-center"
                style={{ borderColor: ok ? "var(--border)" : "var(--alert)" }}
              >
                <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: "var(--gold)" }}>B{b}</div>
                <div className="font-display text-2xl mt-1">
                  {count}<span className="text-xs text-muted-foreground">/{required}</span>
                </div>
                {sizeDraft ? (
                  <input
                    type="number"
                    min={0}
                    value={sizeDraft[b]}
                    onChange={(e) => setSizeDraft({ ...sizeDraft, [b]: e.target.value })}
                    className="w-full mt-2 px-1 py-1 text-xs border border-input text-center bg-white"
                  />
                ) : (
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">
                    {required === 0 ? "Unset" : count === required ? "OK" : count < required ? `Need ${required - count}` : `Over ${count - required}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {(() => {
        const issues = BUCKETS.filter((b) => (sizes[b] ?? 0) > 0 && (counts[b] ?? 0) !== sizes[b]);
        const unset = BUCKETS.filter((b) => (sizes[b] ?? 0) === 0);
        if (issues.length === 0 && unset.length === 0) return null;
        return (
          <div className="mb-6 p-3 border border-border bg-destructive/10 text-xs space-y-1">
            {issues.length > 0 && <div>Buckets {issues.join(", ")} don't match their configured size yet.</div>}
            {unset.length > 0 && <div>Buckets {unset.join(", ")} have no size set — edit sizes above.</div>}
          </div>
        );
      })()}

      {/* Bulk upload */}
      <div className="mb-6 border border-border bg-card">
        <button
          onClick={() => setBulkOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted"
        >
          <span className="font-display text-sm uppercase tracking-widest">Bulk upload</span>
          <span className="text-xs text-muted-foreground">{bulkOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {bulkOpen && (
          <div className="p-4 border-t border-border space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste one golfer per line: <code className="font-mono">Name, Bucket</code> (comma or tab separated). Bucket = 1–7.
              Matches against golfer standard name & aliases.
            </p>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Scottie Scheffler, 1\nRory McIlroy, 1\nXander Schauffele\t2"}
              rows={8}
              className="w-full px-3 py-2 border border-input bg-white text-sm font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={runBulkUpload}
                disabled={bulkBusy || !bulkText.trim()}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--forest-deep)" }}
              >
                {bulkBusy ? "Uploading…" : "Upload"}
              </button>
              <button
                onClick={() => { setBulkText(""); setBulkLog([]); }}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50"
              >
                Clear
              </button>
            </div>
            {bulkLog.length > 0 && (
              <div className="max-h-48 overflow-y-auto bg-muted/50 border border-border p-2 text-[11px] font-mono space-y-0.5">
                {bulkLog.map((l, i) => (
                  <div key={i} className={l.startsWith("MISS") || l.startsWith("SKIP") || l.startsWith("ERROR") ? "text-destructive" : ""}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-8">

        {/* Field */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg uppercase">In Field ({field.length})</h2>
            <button
              onClick={autoAssignAll}
              disabled={field.length === 0}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50"
            >
              Auto-assign by OWGR
            </button>
          </div>
          <div className="bg-card border border-border max-h-[600px] overflow-y-auto">
            {fieldRows.length === 0 && <p className="p-4 text-sm text-muted-foreground">Add golfers from the right →</p>}
            {fieldRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{row.golfer?.standard_name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">OWGR {row.golfer?.owgr_rank ?? "—"}</div>
                </div>
                <select
                  value={row.owgr_bucket}
                  onChange={(e) => setBucket(row.id, parseInt(e.target.value, 10))}
                  className="text-xs border border-input px-2 py-1 bg-white"
                  title={BUCKET_LABELS[row.owgr_bucket]}
                >
                  {BUCKETS.map((b) => <option key={b} value={b}>B{b}</option>)}
                </select>
                <button
                  onClick={() => removeFromField(row.id)}
                  className="px-2 py-1 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Available */}
        <section>
          <h2 className="font-display text-lg uppercase mb-3">Add Golfers</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search golfers…"
            className="w-full px-3 py-2 border border-input bg-white text-sm mb-2"
          />
          <div className="bg-card border border-border max-h-[600px] overflow-y-auto">
            {available.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matching golfers.</p>}
            {available.slice(0, 300).map((g: any) => {
              const suggested = suggestBucketFromSizes(g.owgr_rank, sizes);
              return (
                <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{g.standard_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">OWGR {g.owgr_rank ?? "—"} · suggests B{suggested}</div>
                  </div>
                  <button
                    onClick={() => addToField(g.id, g.owgr_rank)}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                    style={{ backgroundColor: "var(--forest-deep)" }}
                  >
                    Add
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
