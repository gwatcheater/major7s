import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ShieldAlert,
  UserCheck,
  UserX,
  Users,
  ClipboardList,
  Trophy,
  Upload,
} from "lucide-react";
import { AdvancedFieldPortal } from "@/components/admin/advanced-field-portal";
import { bulkCreateApprovedUsers } from "@/lib/admin-users.functions";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip as ReTooltip,
} from "recharts";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminConsole,
});

type Status = "pending" | "approved" | "rejected";
type TournamentStatus = "upcoming" | "open_for_picks" | "picks_closed" | "live" | "completed";

const TSTATUS_LABEL: Record<TournamentStatus, string> = {
  upcoming: "Upcoming",
  open_for_picks: "Open for Picks",
  picks_closed: "Picks Closed",
  live: "Live",
  completed: "Completed",
};

function AdminConsole() {
  const { isAdmin, loading } = useAuth();

  if (loading) return <div className="p-12 text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-12 max-w-xl">
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Restricted</AlertTitle>
          <AlertDescription>You don't have admin access.</AlertDescription>
        </Alert>
        <Link to="/home" className="mt-6 inline-block text-xs uppercase underline">← Home</Link>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="p-4 md:p-8 lg:p-12 max-w-7xl mx-auto">
        <header className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
            Governance
          </p>
          <h1 className="font-display text-3xl md:text-4xl uppercase mt-1">Admin Management Center</h1>
        </header>

        <Tabs defaultValue="approvals" className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
            <TabsTrigger value="approvals" className="text-xs gap-1.5"><UserCheck className="size-3.5" />Approvals</TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs gap-1.5"><Users className="size-3.5" />Bulk Import</TabsTrigger>
            <TabsTrigger value="tournament" className="text-xs gap-1.5"><Trophy className="size-3.5" />Tournament</TabsTrigger>
            <TabsTrigger value="picks" className="text-xs gap-1.5"><ClipboardList className="size-3.5" />Submissions</TabsTrigger>
          </TabsList>

          <TabsContent value="approvals" className="mt-6"><ApprovalsTab /></TabsContent>
          <TabsContent value="bulk" className="mt-6"><BulkImportTab /></TabsContent>
          <TabsContent value="tournament" className="mt-6"><TournamentTab /></TabsContent>
          <TabsContent value="picks" className="mt-6"><SubmissionsTab /></TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

/* ============================================================
   TAB 1 — USER APPROVAL QUEUE
   ============================================================ */
function ApprovalsTab() {
  const qc = useQueryClient();
  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["admin-pending-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, email, first_name, last_name, phone, team_nickname, referral_name, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function setStatus(id: string, status: Status, label: string) {
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(`User ${label}`);
      qc.invalidateQueries({ queryKey: ["admin-pending-profiles"] });
      qc.invalidateQueries({ queryKey: ["admin-users-profiles"] });
      qc.invalidateQueries({ queryKey: ["admin-approved-profiles"] });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Pending Approval Queue</span>
          <span className="text-xs font-mono text-muted-foreground">{pending.length} waiting</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : pending.length === 0 ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>All clear</AlertTitle>
            <AlertDescription>No users are awaiting approval.</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Referral</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => {
                  const full = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.nickname;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{full}</div>
                        <div className="text-xs text-muted-foreground">{p.email ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{p.phone ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-sm">{p.team_nickname ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.referral_name ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => setStatus(p.id, "approved", "approved")}
                          >
                            <UserCheck className="size-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            className="bg-rose-600 hover:bg-rose-700 text-white"
                            onClick={() => setStatus(p.id, "rejected", "rejected")}
                          >
                            <UserX className="size-3.5" /> Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   TAB 2 — BULK USER GENERATION
   ============================================================ */
function BulkImportTab() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflictMode, setConflictMode] = useState<"skip" | "overwrite" | "abort">("skip");
  const [report, setReport] = useState<null | { succeeded: number; failed: number; created?: number; overwritten?: number; skipped?: number; aborted?: boolean; results: Array<{ email: string; ok: boolean; action?: string; error?: string }> }>(null);
  const bulk = useServerFn(bulkCreateApprovedUsers);
  const qc = useQueryClient();

  const parsed = useMemo(() => {
    const rows: Array<{ email: string; first_name: string; last_name: string; phone: string; team_nickname: string; referral_name: string }> = [];
    const errors: Array<{ line: number; reason: string }> = [];
    text.split(/\r?\n/).forEach((raw, idx) => {
      const line = idx + 1;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const parts = trimmed.split(",").map((p) => p.trim());
      if (parts.length < 1 || !parts[0]) {
        errors.push({ line, reason: "Missing email" });
        return;
      }
      const [email, first_name = "", last_name = "", phone = "", team_nickname = "", referral_name = ""] = parts;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ line, reason: `Invalid email: ${email}` });
        return;
      }
      rows.push({ email, first_name, last_name, phone, team_nickname, referral_name });
    });
    return { rows, errors };
  }, [text]);

  async function execute() {
    if (parsed.rows.length === 0 || parsed.errors.length > 0) return;
    setBusy(true);
    setReport(null);
    try {
      const res = await bulk({ data: { rows: parsed.rows, conflictMode } });
      setReport(res);
      const parts: string[] = [];
      if (res.created) parts.push(`Created ${res.created}`);
      if (res.overwritten) parts.push(`Overwritten ${res.overwritten}`);
      if (res.skipped) parts.push(`Skipped ${res.skipped}`);
      if (res.aborted) parts.push("aborted on duplicate");
      if (res.succeeded > 0) toast.success(parts.join(" · ") || `Imported ${res.succeeded}`);
      else if (res.aborted) toast.error(`Batch aborted: ${parts.join(" · ")}`);
      if (res.failed > 0) toast.error(`${res.failed} row${res.failed === 1 ? "" : "s"} failed`);
      qc.invalidateQueries({ queryKey: ["admin-users-profiles"] });
      qc.invalidateQueries({ queryKey: ["admin-approved-profiles"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk User Generation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Upload className="size-4" />
          <AlertTitle>Expected Format</AlertTitle>
          <AlertDescription>
            <code className="text-xs font-mono">Email, FirstName, LastName, Phone, TeamName, ReferralName</code>
            <p className="text-xs mt-1 text-muted-foreground">One user per line. Only Email is required. Accounts are auto-approved.</p>
          </AlertDescription>
        </Alert>

        <div className="rounded-md border p-3 space-y-2">
          <Label className="text-xs uppercase tracking-widest">Conflict Ingestion Mode</Label>
          <RadioGroup
            value={conflictMode}
            onValueChange={(v) => setConflictMode(v as "skip" | "overwrite" | "abort")}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40">
              <RadioGroupItem value="skip" id="conflict-skip" className="mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold">Skip Existing</div>
                <div className="text-muted-foreground">Leave existing accounts untouched.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40">
              <RadioGroupItem value="overwrite" id="conflict-overwrite" className="mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold">Overwrite Data</div>
                <div className="text-muted-foreground">Update profile fields & re-approve.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40">
              <RadioGroupItem value="abort" id="conflict-abort" className="mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold">Abort Batch</div>
                <div className="text-muted-foreground">Halt on first duplicate email.</div>
              </div>
            </label>
          </RadioGroup>
        </div>



        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"jane@example.com, Jane, Doe, 555-1212, Birdie Brigade, Mike\njohn@example.com, John, Smith"}
          className="min-h-[220px] font-mono text-sm"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={execute} disabled={busy || parsed.rows.length === 0 || parsed.errors.length > 0}>
            {busy ? "Importing…" : `Execute Bulk Import (${parsed.rows.length})`}
          </Button>
          <div className="text-xs font-mono text-muted-foreground">
            <span className="text-emerald-600">{parsed.rows.length} valid</span>
            {" · "}
            <span className="text-destructive">{parsed.errors.length} errors</span>
          </div>
        </div>

        {parsed.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Fix these rows before importing</AlertTitle>
            <AlertDescription>
              <ul className="text-xs mt-1 list-disc pl-5">
                {parsed.errors.map((e) => (
                  <li key={e.line}>Line {e.line}: {e.reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {report && (
          <div className="border rounded-md p-3 text-xs space-y-1 max-h-64 overflow-y-auto">
            <div className="font-bold">Result: {report.succeeded} succeeded, {report.failed} failed</div>
            {report.results.map((r, i) => (
              <div key={i} className={r.ok ? "text-emerald-600" : "text-destructive"}>
                {r.ok ? "✓" : "✗"} {r.email}{r.error ? ` — ${r.error}` : ""}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   TAB 3 — TOURNAMENT FIELD MANAGER
   ============================================================ */
function TournamentTab() {
  const qc = useQueryClient();
  const { data: tournaments = [] } = useQuery({
    queryKey: ["admin-tournaments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, location, status, start_date, end_date, submission_deadline, logo_url")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tournaments.find((t) => t.id === selectedId) ?? tournaments[0] ?? null;

  return (
    <div className="space-y-6">
      <CreateTournamentForm onCreated={(id) => { qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] }); setSelectedId(id); }} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span>Manage Existing Tournament</span>
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="text-xs px-2 py-1 border border-input rounded-md bg-background"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-sm text-muted-foreground">Create a tournament to begin.</p>
          ) : (
            <div className="space-y-6">
              <RosterDiagnostics tournamentId={selected.id} />
              <AdvancedFieldPortal tournamentId={selected.id} tournamentName={selected.name} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateTournamentForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: "",
    location: "",
    logo_url: "",
    start_date: "",
    end_date: "",
    submission_deadline: "",
    status: "upcoming" as TournamentStatus,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.location || !form.start_date || !form.end_date || !form.submission_deadline) {
      toast.error("Fill in all required fields");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from("tournaments").insert({
      name: form.name,
      location: form.location,
      logo_url: form.logo_url || null,
      start_date: form.start_date,
      end_date: form.end_date,
      submission_deadline: new Date(form.submission_deadline).toISOString(),
      status: form.status,
    }).select("id").single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Tournament created");
    setForm({ name: "", location: "", logo_url: "", start_date: "", end_date: "", submission_deadline: "", status: "upcoming" });
    onCreated(data.id);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Create New Tournament</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></div>
          <div><Label>Location *</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120} /></div>
          <div className="md:col-span-2"><Label>Logo URL</Label><Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…" /></div>
          <div><Label>Start Date *</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><Label>End Date *</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div><Label>Submission Deadline *</Label><Input type="datetime-local" value={form.submission_deadline} onChange={(e) => setForm({ ...form, submission_deadline: e.target.value })} /></div>
          <div>
            <Label>Status</Label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TournamentStatus })}
              className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
            >
              {(Object.keys(TSTATUS_LABEL) as TournamentStatus[]).map((s) => (
                <option key={s} value={s}>{TSTATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Tournament"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RosterDiagnostics({ tournamentId }: { tournamentId: string }) {
  const { data: golfers = [] } = useQuery({
    queryKey: ["admin-roster-diag", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("bucket_number")
        .eq("tournament_id", tournamentId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const chart = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const g of golfers) counts[g.bucket_number] = (counts[g.bucket_number] ?? 0) + 1;
    return [1, 2, 3, 4, 5, 6, 7].map((b) => ({ bucket: `B${b}`, count: counts[b] ?? 0 }));
  }, [golfers]);

  const warnings = chart.filter((c) => c.count > 0 && c.count < 4);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Roster Balance Diagnostics</CardTitle></CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" />
              <YAxis allowDecimals={false} />
              <ReTooltip />
              <ReferenceLine y={4} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "Min 4", fontSize: 10, fill: "#dc2626" }} />
              <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {warnings.length > 0 && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="size-4" />
            <AlertTitle>Asymmetry Warning</AlertTitle>
            <AlertDescription className="text-xs">
              Bucket{warnings.length > 1 ? "s" : ""} {warnings.map((w) => w.bucket).join(", ")} below the 4-entry threshold.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   TAB 4 — SUBMISSIONS LEADERBOARD
   ============================================================ */
function SubmissionsTab() {
  const { data: tournaments = [] } = useQuery({
    queryKey: ["admin-tournaments-picks-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select("id, name, start_date")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const activeId = tournamentId ?? tournaments[0]?.id ?? null;

  const { data: approved = [] } = useQuery({
    queryKey: ["admin-approved-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, email, first_name, last_name, phone, team_nickname")
        .eq("status", "approved");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Embedded join: picks → teams (FK exists) and picks → golfers (FK exists)
  const { data: fetchedPicks = [] } = useQuery({
    enabled: !!activeId,
    queryKey: ["admin-picks-for-tournament", activeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picks")
        .select(`
          id,
          bucket,
          tweak_count,
          tournament_id,
          golfers ( golfer_name ),
          teams!inner ( id, nickname, owner_user_id )
        `)
        .eq("tournament_id", activeId!);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        bucket: number;
        tweak_count: number;
        tournament_id: string;
        golfers: { golfer_name: string } | null;
        teams: { id: string; nickname: string; owner_user_id: string };
      }>;
    },
  });

  // JS pivot: one row per team
  type PivotRow = {
    teamId: string;
    teamName: string;
    ownerUserId: string;
    buckets: Record<number, string | undefined>;
    tweaks: number;
  };
  const pivotedRows = useMemo<PivotRow[]>(() => {
    const m = new Map<string, PivotRow>();
    for (const p of fetchedPicks) {
      const t = p.teams;
      if (!t) continue;
      const entry = m.get(t.id) ?? {
        teamId: t.id,
        teamName: t.nickname,
        ownerUserId: t.owner_user_id,
        buckets: {},
        tweaks: 0,
      };
      entry.buckets[p.bucket] = p.golfers?.golfer_name;
      entry.tweaks = Math.max(entry.tweaks, p.tweak_count ?? 0);
      m.set(t.id, entry);
    }
    return Array.from(m.values());
  }, [fetchedPicks]);

  // Profile lookup by user id (for resolving names/email/phone on the grid)
  const profileById = useMemo(() => {
    const m = new Map<string, (typeof approved)[number]>();
    for (const u of approved) m.set(u.id, u);
    return m;
  }, [approved]);

  // Tournament-scoped intersection
  const activeApprovedUsers = approved;
  const usersWithPicksForThisTournament = useMemo(
    () => new Set(pivotedRows.map((r) => r.ownerUserId).filter(Boolean)),
    [pivotedRows],
  );
  const usersWhoHaveNotEnteredYet = useMemo(
    () => activeApprovedUsers.filter((u) => !usersWithPicksForThisTournament.has(u.id)),
    [activeApprovedUsers, usersWithPicksForThisTournament],
  );

  function copyEmails() {
    const list = usersWhoHaveNotEnteredYet.map((u) => u.email).filter(Boolean).join(", ");
    navigator.clipboard.writeText(list).then(
      () => toast.success(`Copied ${usersWhoHaveNotEnteredYet.length} email${usersWhoHaveNotEnteredYet.length === 1 ? "" : "s"}`),
      () => toast.error("Clipboard copy failed"),
    );
  }

  function nameFor(row: PivotRow): { full: string; email: string; phone: string } {
    const p = profileById.get(row.ownerUserId);
    if (!p) return { full: row.teamName, email: "", phone: "" };
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.nickname;
    return { full, email: p.email ?? "", phone: p.phone ?? "" };
  }

  function exportCsv() {
    const headers = ["UUID","First Name","Last Name","Email","Team Name (Leaderboard Display)","Bucket 1","Bucket 2","Bucket 3","Bucket 4","Bucket 5","Bucket 6","Bucket 7"];
    const lines = [headers.join(",")];
    for (const r of pivotedRows) {
      const p = profileById.get(r.ownerUserId);
      const cells = [
        r.ownerUserId,
        p?.first_name ?? "",
        p?.last_name ?? "",
        p?.email ?? "",
        r.teamName,
        ...[1, 2, 3, 4, 5, 6, 7].map((b) => r.buckets[b] ?? ""),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tname = tournaments.find((t) => t.id === activeId)?.name ?? "tournament";
    a.href = url;
    a.download = `picks-${tname.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-xs uppercase tracking-widest">Tournament</Label>
        <select
          value={activeId ?? ""}
          onChange={(e) => setTournamentId(e.target.value)}
          className="text-sm px-3 py-1.5 border border-input rounded-md bg-background"
        >
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Total Active Approved Users" value={activeApprovedUsers.length} />
        <Kpi label="Total Submissions Made" value={usersWithPicksForThisTournament.size} />
        <Kpi label="Missing Entries" value={usersWhoHaveNotEnteredYet.length} highlight={usersWhoHaveNotEnteredYet.length > 0} />
      </div>

      {usersWhoHaveNotEnteredYet.length > 0 && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>{usersWhoHaveNotEnteredYet.length} approved user{usersWhoHaveNotEnteredYet.length === 1 ? "" : "s"} have not submitted</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={copyEmails}>
                  <Copy className="size-3.5" /> Copy All Email Addresses
                </Button>
              </TooltipTrigger>
              <TooltipContent>Comma-separated, ready to paste into an email blast.</TooltipContent>
            </Tooltip>
          </AlertTitle>
          <AlertDescription>
            <div className="mt-2 max-h-48 overflow-y-auto text-xs">
              <table className="w-full">
                <tbody>
                  {usersWhoHaveNotEnteredYet.map((u) => {
                    const full = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.nickname;
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-1 pr-2">{full}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{u.team_nickname ?? "—"}</td>
                        <td className="py-1 text-muted-foreground">{u.email ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>Submissions Spreadsheet</span>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="size-3.5" /> Export Picks to CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team Name (Leaderboard Display)</TableHead>
                {[1, 2, 3, 4, 5, 6, 7].map((b) => (
                  <TableHead key={b}>Bucket {b}</TableHead>
                ))}
                <TableHead className="text-right">Tweaks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivotedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">
                    No submissions yet for this tournament.
                  </TableCell>
                </TableRow>
              ) : (
                pivotedRows.map((r) => (
                  <TableRow key={r.teamId}>
                    <TableCell className="text-sm">{r.teamName}</TableCell>
                    {[1, 2, 3, 4, 5, 6, 7].map((b) => (
                      <TableCell key={b} className="text-xs">
                        {r.buckets[b] ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono">{r.tweaks}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-destructive" : ""}>
      <CardContent className="p-5">
        <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{label}</div>
        <div className={`font-display text-4xl mt-1 ${highlight ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
