import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdminDesktopOnly } from "@/components/admin-desktop-only";
import { AdvancedFieldPortal } from "@/components/admin/advanced-field-portal";

export const Route = createFileRoute("/_authenticated/admin/tournament/$id/field")({
  component: () => <AdminDesktopOnly><AdminFieldPage /></AdminDesktopOnly>,
});

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
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

function AdminFieldPage() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [sizeDraft, setSizeDraft] = useState<Record<number, string> | null>(null);
  
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [picksOpen, setPicksOpen] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; location: string; start_date: string; end_date: string; submission_deadline: string } | null>(null);

  // New-golfer form
  const [newName, setNewName] = useState("");
  const [newRank, setNewRank] = useState("");
  const [newBucket, setNewBucket] = useState<number>(1);

  const { data: tournament, refetch: refetchTournament } = useQuery({
    queryKey: ["admin-field-tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const sizes = useMemo(() => normalizeSizes((tournament as any)?.bucket_sizes), [tournament]);

  const { data: golfers = [], refetch } = useQuery({
    queryKey: ["admin-field-golfers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name, owgr_rank, bucket_number")
        .eq("tournament_id", id)
        .order("bucket_number", { ascending: true })
        .order("owgr_rank", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allPicks = [], refetch: refetchPicks } = useQuery({
    queryKey: ["admin-tournament-picks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("id, bucket, team_id, golfer_id, submitted_at, team:teams(nickname, owner_user_id, is_primary), golfer:golfers(golfer_name)")
        .eq("tournament_id", id)
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  if (!isAdmin) {
    return (
      <div className="p-12">
        <p className="text-sm text-muted-foreground">Admin only.</p>
        <Link to="/home" className="text-xs uppercase underline">← Back</Link>
      </div>
    );
  }

  async function addGolfer() {
    const name = newName.trim();
    if (!name) { toast.error("Golfer name required"); return; }
    const rank = newRank.trim() ? parseInt(newRank, 10) : null;
    const { error } = await supabase.from("golfers").insert({
      tournament_id: id,
      golfer_name: name,
      owgr_rank: rank,
      bucket_number: newBucket,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${name} to B${newBucket}`);
    setNewName(""); setNewRank("");
    refetch(); qc.invalidateQueries({ queryKey: ["field", id] });
  }

  async function removeGolfer(rowId: string) {
    if (!confirm("Remove this golfer from the field?")) return;
    const { error } = await supabase.from("golfers").delete().eq("id", rowId);
    if (error) toast.error(error.message);
    else { refetch(); qc.invalidateQueries({ queryKey: ["field", id] }); }
  }

  async function setBucket(rowId: string, bucket: number) {
    const { error } = await supabase.from("golfers").update({ bucket_number: bucket }).eq("id", rowId);
    if (error) toast.error(error.message);
    else { refetch(); qc.invalidateQueries({ queryKey: ["field", id] }); }
  }

  async function autoAssignAll() {
    if (golfers.length === 0) { toast.error("No golfers yet"); return; }
    const rows = [...golfers].sort((a, b) => (a.owgr_rank ?? 1e9) - (b.owgr_rank ?? 1e9));
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
      updates.map((u) => supabase.from("golfers").update({ bucket_number: u.bucket }).eq("id", u.id)),
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
    const { error } = await supabase.from("tournaments").update({ bucket_sizes: next as any }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Bucket sizes saved");
    setSizeDraft(null);
    refetchTournament();
  }

  function openDetails() {
    if (!tournament) return;
    const lockLocal = (() => {
      const d = new Date((tournament as any).submission_deadline);
      const tz = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tz).toISOString().slice(0, 16);
    })();
    setDetailsDraft({
      name: (tournament as any).name ?? "",
      location: (tournament as any).location ?? "",
      start_date: (tournament as any).start_date ?? "",
      end_date: (tournament as any).end_date ?? "",
      submission_deadline: lockLocal,
    });
    setDetailsOpen(true);
  }

  async function saveDetails() {
    if (!detailsDraft) return;
    const { name, location, start_date, end_date, submission_deadline } = detailsDraft;
    if (!name || !location || !start_date || !end_date || !submission_deadline) {
      toast.error("All fields required"); return;
    }
    const { error } = await supabase
      .from("tournaments")
      .update({ name, location, start_date, end_date, submission_deadline: new Date(submission_deadline).toISOString() })
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

  const counts: Record<number, number> = {};
  for (const g of golfers) counts[g.bucket_number] = (counts[g.bucket_number] ?? 0) + 1;


  return (
    <div className="p-8 md:p-12 max-w-6xl">
      <Link to="/admin" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Admin</Link>
      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Field Management</p>
        <h1 className="font-display text-3xl uppercase mt-1">{tournament?.name ?? "Tournament"}</h1>
        <p className="text-sm text-muted-foreground">{(tournament as any)?.location}</p>
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
                <Labeled label="Name"><input className={inputCls} value={detailsDraft.name} onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })} /></Labeled>
                <Labeled label="Location"><input className={inputCls} value={detailsDraft.location} onChange={(e) => setDetailsDraft({ ...detailsDraft, location: e.target.value })} /></Labeled>
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Start"><input type="date" className={inputCls} value={detailsDraft.start_date} onChange={(e) => setDetailsDraft({ ...detailsDraft, start_date: e.target.value })} /></Labeled>
                  <Labeled label="End"><input type="date" className={inputCls} value={detailsDraft.end_date} onChange={(e) => setDetailsDraft({ ...detailsDraft, end_date: e.target.value })} /></Labeled>
                </div>
                <Labeled label="Submission deadline"><input type="datetime-local" className={inputCls} value={detailsDraft.submission_deadline} onChange={(e) => setDetailsDraft({ ...detailsDraft, submission_deadline: e.target.value })} /></Labeled>
                <div className="flex gap-2">
                  <button onClick={saveDetails} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>Save</button>
                  <button onClick={() => setDetailsDraft(null)} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submitted picks */}
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
                          <span className="truncate">{p.golfer?.golfer_name ?? p.golfer_id}</span>
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

      {/* Bucket sizes */}
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
              <div key={b} className="bg-card border p-3 text-center" style={{ borderColor: ok ? "var(--border)" : "var(--alert)" }}>
                <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: "var(--gold)" }}>B{b}</div>
                <div className="font-display text-2xl mt-1">
                  {count}<span className="text-xs text-muted-foreground">/{required}</span>
                </div>
                {sizeDraft ? (
                  <input
                    type="number" min={0} value={sizeDraft[b]}
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

      {/* Add single golfer */}
      <div className="mb-6">
        <div className="border border-border bg-card p-4 max-w-xl">
          <h2 className="font-display text-sm uppercase tracking-widest mb-3">Add single golfer</h2>
          <div className="space-y-2">
            <input className={inputCls} placeholder="Golfer name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} type="number" placeholder="OWGR rank (optional)" value={newRank} onChange={(e) => setNewRank(e.target.value)} />
              <select className={inputCls} value={newBucket} onChange={(e) => setNewBucket(parseInt(e.target.value, 10))}>
                {BUCKETS.map((b) => <option key={b} value={b}>Bucket {b}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={addGolfer} className="flex-1 py-2 text-[10px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>Add</button>
              <button onClick={autoAssignAll} disabled={golfers.length === 0} className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50">
                Auto-assign by OWGR
              </button>
            </div>
          </div>
        </div>
      </div>

      <AdvancedFieldPortal tournamentId={id} tournamentName={tournament?.name ?? ""} />
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">{label}</label>
      {children}
    </div>
  );
}
