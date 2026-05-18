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
  1: "Tier 1 · OWGR 1—10",
  2: "Tier 2 · OWGR 11—25",
  3: "Tier 3 · OWGR 26—50",
  4: "Tier 4 · OWGR 51—75",
  5: "Tier 5 · OWGR 76—100",
  6: "Tier 6 · Wildcard A",
  7: "Tier 7 · Wildcard B",
};

function suggestBucket(rank: number | null | undefined): number {
  if (!rank) return 6;
  if (rank <= 10) return 1;
  if (rank <= 25) return 2;
  if (rank <= 50) return 3;
  if (rank <= 75) return 4;
  if (rank <= 100) return 5;
  return 6;
}

function AdminFieldPage() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: tournament } = useQuery({
    queryKey: ["admin-field-tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: golfers = [] } = useQuery({
    queryKey: ["admin-field-golfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, standard_name, owgr_rank")
        .order("owgr_rank", { ascending: true, nullsFirst: false })
        .limit(1000);
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
    const bucket = suggestBucket(rank);
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

  async function autoAssignAll() {
    const updates = field.map((f) => {
      const g = golfers.find((x: any) => x.id === f.golfer_id);
      return { id: f.id, bucket: suggestBucket(g?.owgr_rank) };
    });
    for (const u of updates) {
      await supabase.from("tournament_field").update({ owgr_bucket: u.bucket }).eq("id", u.id);
    }
    toast.success("Buckets auto-assigned by OWGR");
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

      <div className="grid grid-cols-7 gap-2 mb-6">
        {BUCKETS.map((b) => (
          <div key={b} className="bg-card border border-border p-3 text-center">
            <div className="text-[10px] uppercase font-bold tracking-widest" style={{ color: "var(--gold)" }}>B{b}</div>
            <div className="font-display text-2xl mt-1">{counts[b] ?? 0}</div>
          </div>
        ))}
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
            {available.slice(0, 300).map((g: any) => (
              <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{g.standard_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">OWGR {g.owgr_rank ?? "—"} · suggests B{suggestBucket(g.owgr_rank)}</div>
                </div>
                <button
                  onClick={() => addToField(g.id, g.owgr_rank)}
                  className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                  style={{ backgroundColor: "var(--forest-deep)" }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
