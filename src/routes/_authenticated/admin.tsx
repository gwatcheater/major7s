import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPanel,
});

function AdminPanel() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "tournaments" | "golfers">("overview");

  if (!isAdmin) {
    return (
      <div className="p-12 max-w-2xl">
        <h1 className="font-display text-3xl uppercase mb-3">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">
          You don't have admin access. Ask an existing admin to grant you the role (in the user_roles table, add a row with your user id and role 'admin').
        </p>
        <Link to="/home" className="mt-6 inline-block text-xs uppercase tracking-widest underline">← Back</Link>
      </div>
    );
  }

  return (
    <div className="p-8 md:p-12 max-w-6xl">
      <header className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Governance</p>
        <h1 className="font-display text-4xl uppercase mt-1">Admin Panel</h1>
      </header>

      <div className="flex gap-1 border-b border-border mb-8">
        {(["overview", "tournaments", "golfers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs uppercase tracking-widest font-bold border-b-2 -mb-px ${tab === t ? "border-primary" : "border-transparent text-muted-foreground"}`}
          >{t}</button>
        ))}
      </div>

      {tab === "overview" ? <Overview qc={qc} /> : tab === "tournaments" ? <TournamentsAdmin qc={qc} /> : <GolfersAdmin qc={qc} />}
    </div>
  );
}

type Status = "upcoming" | "open" | "locked" | "live" | "completed";
const STATUSES: Status[] = ["upcoming", "open", "locked", "live", "completed"];
const NEXT: Record<Status, Status | null> = {
  upcoming: "open",
  open: "locked",
  locked: "live",
  live: "completed",
  completed: null,
};

function Overview({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data: tournaments = [], refetch } = useQuery({
    queryKey: ["admin-overview-tournaments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").order("start_date");
      if (error) throw error;
      return data;
    },
  });

  async function setStatus(id: string, status: Status) {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Status → ${status}`);
      refetch();
      qc.invalidateQueries({ queryKey: ["tournaments-active"] });
      qc.invalidateQueries({ queryKey: ["admin-tournaments"] });
    }
  }

  const grouped = STATUSES.map((s) => ({ status: s, items: tournaments.filter((t: any) => t.status === s) }));
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g.items.length]));

  if (tournaments.length === 0) {
    return (
      <div className="bg-card border border-border p-8 text-center">
        <p className="text-sm text-muted-foreground mb-3">No tournaments yet.</p>
        <p className="text-xs text-muted-foreground">Switch to the <span className="font-bold uppercase">Tournaments</span> tab to create one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.map((s) => (
          <div key={s} className="bg-card border border-border p-4">
            <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--gold)" }}>{s}</div>
            <div className="font-display text-3xl mt-1">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Grouped tournaments */}
      {grouped.map(({ status, items }) => (
        items.length > 0 && (
          <section key={status}>
            <h2 className="font-display text-lg uppercase mb-3 flex items-baseline gap-3">
              <span>{status}</span>
              <span className="text-xs text-muted-foreground font-sans normal-case tracking-normal">{items.length} tournament{items.length === 1 ? "" : "s"}</span>
            </h2>
            <div className="space-y-2">
              {items.map((t: any) => (
                <div key={t.id} className="bg-card border border-border p-4 flex flex-wrap gap-4 items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm uppercase truncate">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.course}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {t.start_date} → {t.end_date} · lock {new Date(t.lock_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    {NEXT[status] && (
                      <button
                        onClick={() => setStatus(t.id, NEXT[status]!)}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white"
                        style={{ backgroundColor: "var(--forest-deep)" }}
                      >
                        Advance → {NEXT[status]}
                      </button>
                    )}
                    <select
                      value={t.status}
                      onChange={(e) => setStatus(t.id, e.target.value as Status)}
                      className="text-xs border border-input px-2 py-1 bg-white"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <Link
                      to="/admin/tournament/$id/field"
                      params={{ id: t.id }}
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted"
                    >
                      Field
                    </Link>
                    <Link
                      to="/tournament/$id"
                      params={{ id: t.id }}
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      ))}
    </div>
  );
}


function TournamentsAdmin({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lockAt, setLockAt] = useState("");

  const { data: tournaments = [], refetch } = useQuery({
    queryKey: ["admin-tournaments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tournaments").select("*").order("start_date");
      if (error) throw error;
      return data;
    },
  });

  async function create() {
    if (!name || !course || !startDate || !endDate || !lockAt) {
      toast.error("Fill all fields"); return;
    }
    const { error } = await supabase.from("tournaments").insert({
      name, course, start_date: startDate, end_date: endDate, lock_at: new Date(lockAt).toISOString(), status: "upcoming",
    });
    if (error) toast.error(error.message);
    else { toast.success("Tournament created"); setName(""); setCourse(""); setStartDate(""); setEndDate(""); setLockAt(""); refetch(); qc.invalidateQueries({ queryKey: ["tournaments-active"] }); }
  }

  async function updateStatus(id: string, status: "upcoming" | "open" | "locked" | "live" | "completed") {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Status → ${status}`); refetch(); qc.invalidateQueries({ queryKey: ["tournaments-active"] }); }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div>
        <h2 className="font-display text-lg uppercase mb-4">Create Tournament</h2>
        <div className="space-y-3 bg-card p-6 border border-border">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Masters" /></Field>
          <Field label="Course"><input className={inputCls} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Augusta National GC" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date"><input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="End Date"><input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <Field label="Lock Cutoff (server time)">
            <input type="datetime-local" className={inputCls} value={lockAt} onChange={(e) => setLockAt(e.target.value)} />
          </Field>
          <button onClick={create} className="w-full py-3 font-display text-xs uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>
            Create
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg uppercase mb-4">Existing Tournaments</h2>
        <div className="space-y-2">
          {tournaments.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {tournaments.map((t: any) => (
            <div key={t.id} className="bg-card p-4 border border-border">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <div className="font-display text-sm uppercase">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.course}</div>
                  <div className="text-[10px] uppercase tracking-widest mt-1" style={{ color: "var(--gold)" }}>{t.status}</div>
                </div>
                <select
                  value={t.status}
                  onChange={(e) => updateStatus(t.id, e.target.value as "upcoming" | "open" | "locked" | "live" | "completed")}
                  className="text-xs border border-input px-2 py-1 bg-white"
                >
                  <option value="upcoming">upcoming</option>
                  <option value="open">open</option>
                  <option value="locked">locked</option>
                  <option value="live">live</option>
                  <option value="completed">completed</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GolfersAdmin({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [csv, setCsv] = useState("");
  const { data: golfers = [], refetch } = useQuery({
    queryKey: ["admin-golfers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("golfers").select("*").order("owgr_rank", { ascending: true, nullsFirst: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  async function bulkUpload() {
    const lines = csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("Paste at least one row"); return; }
    const rows = lines.map((line) => {
      const [name, rank] = line.split(",").map((s) => s.trim());
      return { standard_name: name, owgr_rank: rank ? parseInt(rank, 10) : null };
    });
    const { error } = await supabase.from("golfers").upsert(rows, { onConflict: "standard_name" });
    if (error) toast.error(error.message);
    else { toast.success(`Upserted ${rows.length} golfers`); setCsv(""); refetch(); qc.invalidateQueries(); }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div>
        <h2 className="font-display text-lg uppercase mb-4">Bulk OWGR Upload</h2>
        <p className="text-xs text-muted-foreground mb-2">One golfer per line: <code className="font-mono">Name, Rank</code></p>
        <textarea
          value={csv} onChange={(e) => setCsv(e.target.value)} rows={12}
          placeholder="Scottie Scheffler, 1&#10;Rory McIlroy, 2&#10;Xander Schauffele, 3"
          className="w-full p-3 font-mono text-xs border border-input bg-white"
        />
        <button onClick={bulkUpload} className="mt-3 w-full py-3 font-display text-xs uppercase tracking-widest text-white" style={{ backgroundColor: "var(--forest-deep)" }}>
          Upsert Golfers
        </button>
      </div>
      <div>
        <h2 className="font-display text-lg uppercase mb-4">Current Roster ({golfers.length})</h2>
        <div className="bg-card border border-border max-h-[600px] overflow-y-auto">
          {golfers.map((g: any) => (
            <div key={g.id} className="flex justify-between px-4 py-2 border-b border-border text-sm">
              <span>{g.standard_name}</span>
              <span className="font-mono text-xs text-muted-foreground">{g.owgr_rank ?? "—"}</span>
            </div>
          ))}
          {golfers.length === 0 && <p className="p-4 text-sm text-muted-foreground">No golfers yet.</p>}
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">{label}</label>
      {children}
    </div>
  );
}
