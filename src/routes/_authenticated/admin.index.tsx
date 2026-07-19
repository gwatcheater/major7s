import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
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
  EyeOff,
  ShieldAlert,
  UserCheck,
  UserX,
  Users,
  ClipboardList,
  Trophy,
  Upload,
  MapPin,
  Image as ImageIcon,
  Calendar as CalendarIcon,
  Save,
  MessageCircle,
} from "lucide-react";
import { useImpersonation } from "@/context/impersonation-context";
import { AdvancedFieldPortal } from "@/components/admin/advanced-field-portal";
import { EspnLeaderboardSection } from "@/components/admin/espn-leaderboard-section";
import { BulkPickUpload } from "@/components/admin/bulk-pick-upload";
import { UsersDirectoryTab } from "@/components/admin/users-directory-tab";
import { bulkCreateApprovedUsers } from "@/lib/admin-users.functions";
import {
  buildRoundPositionMap,
  computeRoundScores,
  getInProgressRound,
  isWithdrawn,
  type Round,
  type RoundTeamScore,
  type ScoringLbRow,
} from "@/lib/major7s-round-scoring";


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
        <Link to="/home" className="mt-6 inline-block text-xs uppercase underline">
          ← Home
        </Link>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="p-4 md:p-8 lg:p-12 max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="font-display text-3xl md:text-4xl uppercase">
            Admin Management Center
          </h1>
        </header>

        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="users" className="text-xs gap-1.5">
              <Users className="size-3.5" />
              Users
            </TabsTrigger>
            <TabsTrigger value="tournament" className="text-xs gap-1.5">
              <Trophy className="size-3.5" />
              Tournament
            </TabsTrigger>
            <TabsTrigger value="picks" className="text-xs gap-1.5">
              <ClipboardList className="size-3.5" />
              Submissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
          <TabsContent value="tournament" className="mt-6">
            <TournamentTab />
          </TabsContent>
          <TabsContent value="picks" className="mt-6">
            <SubmissionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}


/* ============================================================
   USERS — stacked: Approvals (top) · Directory (middle) · Bulk Import (bottom)
   ============================================================ */
function UsersTab() {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="space-y-6">
      <ApprovalsTab />
      <UsersDirectoryTab />
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setImportOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left"
          >
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-4" />
              Bulk Import Users
            </CardTitle>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {importOpen ? "Hide ▲" : "Show ▼"}
            </span>
          </button>
        </CardHeader>
        {importOpen && (
          <CardContent>
            <BulkImportTab />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   TAB 1 — USER APPROVAL QUEUE
   ============================================================ */
function SimulateButton({ targetId, displayName }: { targetId: string; displayName: string }) {
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        startImpersonation(targetId);
        toast.success(`Simulation initialized: Acting as ${displayName}`);
        navigate({ to: "/home" });
      }}
    >
      <EyeOff className="size-3.5" /> 🕵️ Simulate User
    </Button>
  );
}

function ApprovalsTab() {
  const qc = useQueryClient();
  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["admin-pending-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, email, first_name, last_name, phone, referral_name, created_at")
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
          {pending.length > 0 ? (
            <span className="text-xs font-bold rounded-full bg-rose-600 text-white px-2 py-0.5">
              {pending.length} waiting
            </span>
          ) : (
            <span className="text-xs font-mono text-muted-foreground">0 waiting</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-1">
            <CheckCircle2 className="size-4 text-emerald-600" />
            No users awaiting approval.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Nickname</TableHead>
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
                      <TableCell className="text-sm">{p.nickname}</TableCell>
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
                          <SimulateButton targetId={p.id} displayName={full} />
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
  const [report, setReport] = useState<null | {
    succeeded: number;
    failed: number;
    created?: number;
    overwritten?: number;
    skipped?: number;
    aborted?: boolean;
    results: Array<{ email: string; ok: boolean; action?: string; error?: string }>;
  }>(null);
  const bulk = useServerFn(bulkCreateApprovedUsers);
  const qc = useQueryClient();

  const parsed = useMemo(() => {
    const rows: Array<{
      email: string;
      first_name: string;
      last_name: string;
      phone: string;
      team_name: string;
      referral_name: string;
    }> = [];
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
      const [email, first_name = "", last_name = "", phone = "", team_name = "", referral_name = ""] = parts;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ line, reason: `Invalid email: ${email}` });
        return;
      }
      rows.push({ email, first_name, last_name, phone, team_name, referral_name });
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
            <code className="text-xs font-mono">
              Email, FirstName, LastName, Phone, TeamName, ReferralName
            </code>
            <p className="text-xs mt-1 text-muted-foreground">
              One user per line. Only Email is required. Accounts are auto-approved.
            </p>
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
          placeholder={
            "jane@example.com, Jane, Doe, 555-1212, Birdie Brigade, Mike\njohn@example.com, John, Smith"
          }
          className="min-h-[220px] font-mono text-sm"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={execute}
            disabled={busy || parsed.rows.length === 0 || parsed.errors.length > 0}
          >
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
                  <li key={e.line}>
                    Line {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {report && (
          <div className="border rounded-md p-3 text-xs space-y-1 max-h-64 overflow-y-auto">
            <div className="font-bold">
              Result: {report.succeeded} succeeded, {report.failed} failed
            </div>
            {report.results.map((r, i) => (
              <div key={i} className={r.ok ? "text-emerald-600" : "text-destructive"}>
                {r.ok ? "✓" : "✗"} {r.email}
                {r.error ? ` — ${r.error}` : ""}
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
        .select(
          // espn_event_id is required so the ESPN leaderboard import section
          // can show the saved ID + load the event-name confirmation preview.
          // Without it, initialEspnEventId arrives as undefined and the panel
          // looks empty even when the DB has the value.
          "id, name, location, status, start_date, end_date, submission_deadline, logo_url, bucket_sizes, espn_event_id, external_url",
        )
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tournaments.find((t) => t.id === selectedId) ?? tournaments[0] ?? null;

  return (
    <div className="space-y-6">
      <CreateTournamentForm
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] });
          // Also refresh the user-facing feeds so newly-created tournaments
          // appear immediately on /home and /archive without a page reload.
          qc.invalidateQueries({ queryKey: ["tournaments-active"] });
          qc.invalidateQueries({ queryKey: ["tournaments-completed"] });
          setSelectedId(id);
        }}
      />

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
                <option key={t.id} value={t.id}>
                  {t.name} ({t.start_date?.slice(0, 4) ?? ''})
                </option>
              ))}
            </select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-sm text-muted-foreground">Create a tournament to begin.</p>
          ) : (
            <div className="space-y-6">
              <TournamentStatusControl
                key={`status-${selected.id}`}
                tournamentId={selected.id}
                currentStatus={selected.status as TournamentStatus}
              />
              <EspnLeaderboardSection
                key={`espn-${selected.id}`}
                tournamentId={selected.id}
                initialEspnEventId={(selected as any).espn_event_id ?? ""}
                onSaved={() => qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] })}
              />
              <EndOfRoundExportPanel
                key={`export-${selected.id}`}
                tournamentId={selected.id}
                tournamentName={selected.name}
              />
              <InProgressUpdatePanel key={`live-update-${selected.id}`} tournamentId={selected.id} />
              <CollapsibleBlock label="Edit Tournament Details" icon={<Save className="size-4" />}>
                <EditTournamentDetailsForm key={`edit-${selected.id}`} tournament={selected} />
              </CollapsibleBlock>
              <BucketSizesEditor
                key={`buckets-${selected.id}`}
                tournamentId={selected.id}
                rawSizes={(selected as any).bucket_sizes}
              />
              <CollapsibleBlock label="Advanced Field Portal" icon={<Trophy className="size-4" />}>
                <AdvancedFieldPortal
                  tournamentId={selected.id}
                  tournamentName={selected.name}
                  bucketSizes={normalizeBucketSizes((selected as any).bucket_sizes)}
                />
              </CollapsibleBlock>
              <CollapsibleBlock label="Bulk Picks Upload (CSV)" icon={<Upload className="size-4" />}>
                <BulkPickUpload key={`bulk-${selected.id}`} tournamentId={selected.id} />
              </CollapsibleBlock>


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
    external_url: "",
    start_date: "",
    end_date: "",
    submission_deadline: "",
    status: "upcoming" as TournamentStatus,
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.name ||
      !form.location ||
      !form.start_date ||
      !form.end_date ||
      !form.submission_deadline
    ) {
      toast.error("Fill in all required fields");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("tournaments")
      .insert({
        name: form.name,
        location: form.location,
        logo_url: form.logo_url || null,
        external_url: form.external_url || null,
        start_date: form.start_date,
        end_date: form.end_date,
        submission_deadline: new Date(form.submission_deadline).toISOString(),
        status: form.status,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tournament created");
    setForm({
      name: "",
      location: "",
      logo_url: "",
      external_url: "",
      start_date: "",
      end_date: "",
      submission_deadline: "",
      status: "upcoming",
    });
    onCreated(data.id);
  }

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4" />
            Create New Tournament
          </CardTitle>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {open ? "Hide ▲" : "Show ▼"}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Name *</Label>
            <select
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((prev) => {
                  const next = { ...prev, name };
                  // Masters Tournament is always at Augusta National Golf Club.
                  // Force-fill on selection; clear when switching to a different major.
                  if (name === "Masters Tournament") {
                    next.location = "Augusta National Golf Club";
                  } else if (prev.name === "Masters Tournament") {
                    next.location = "";
                  }
                  return next;
                });
              }}
              className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
            >
              <option value="" disabled>Select a major…</option>
              <option value="Masters Tournament">Masters Tournament</option>
              <option value="PGA Championship">PGA Championship</option>
              <option value="U.S. Open">U.S. Open</option>
              <option value="The Open Championship">The Open Championship</option>
            </select>
          </div>
          <div>
            <Label>Location *</Label>
            <Input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Logo URL</Label>
            <Input
              value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="md:col-span-2">
            <Label>External Link URL</Label>
            <Input
              value={form.external_url}
              onChange={(e) => setForm({ ...form, external_url: e.target.value })}
              placeholder="https://… (official tournament website)"
            />
          </div>
          <div>
            <Label>Start Date *</Label>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => {
                const start = e.target.value;
                setForm((prev) => {
                  const next = { ...prev, start_date: start };
                  if (start) {
                    // Always recompute end + deadline when the start date changes.
                    // Previous version only auto-populated when those fields were
                    // empty, which created a confusing bug: once set, subsequent
                    // start-date changes wouldn't refresh them, so the form showed
                    // stale dependent dates from an earlier selection. If the
                    // admin needs a non-default end/deadline, they can adjust
                    // those fields after picking the start.
                    //
                    // Build the dates using LOCAL components, not UTC parsing.
                    // `new Date("2024-07-11T00:00:00")` is interpreted as local
                    // midnight by the browser, which is fine — but feeding it
                    // through `.toISOString()` then drops back to UTC, which
                    // can shift the calendar date by a day if the user is west
                    // of UTC. Construct components directly instead.
                    const [yStr, mStr, dStr] = start.split("-");
                    const y = parseInt(yStr, 10);
                    const m = parseInt(mStr, 10); // 1-12
                    const d = parseInt(dStr, 10);
                    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
                      const pad = (n: number) => String(n).padStart(2, "0");

                      // End date = start + 4 days. Use Date arithmetic on a
                      // local midnight, then read the local components back.
                      const endDate = new Date(y, m - 1, d + 4);
                      next.end_date =
                        endDate.getFullYear() + "-" +
                        pad(endDate.getMonth() + 1) + "-" +
                        pad(endDate.getDate());

                      // Submission deadline = start - 1 day at 20:00 local time.
                      const deadline = new Date(y, m - 1, d - 1, 20, 0, 0, 0);
                      next.submission_deadline =
                        deadline.getFullYear() + "-" +
                        pad(deadline.getMonth() + 1) + "-" +
                        pad(deadline.getDate()) + "T" +
                        pad(deadline.getHours()) + ":" +
                        pad(deadline.getMinutes());
                    }
                  }
                  return next;
                });
              }}
            />
          </div>
          <div>
            <Label>End Date *</Label>
            <Input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </div>
          <div>
            <Label>Submission Deadline *</Label>
            <Input
              type="datetime-local"
              value={form.submission_deadline}
              onChange={(e) => setForm({ ...form, submission_deadline: e.target.value })}
            />
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TournamentStatus })}
              className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm"
            >
              {(Object.keys(TSTATUS_LABEL) as TournamentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TSTATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create Tournament"}
            </Button>
          </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function TournamentStatusControl({
  tournamentId,
  currentStatus,
}: {
  tournamentId: string;
  currentStatus: TournamentStatus;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TournamentStatus>(currentStatus);
  const [saving, setSaving] = useState(false);

  async function update(next: TournamentStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    setSaving(true);
    const { error } = await supabase
      .from("tournaments")
      .update({ status: next })
      .eq("id", tournamentId);
    setSaving(false);
    if (error) {
      setStatus(prev);
      toast.error(error.message);
      return;
    }
    toast.success(`Status updated → ${TSTATUS_LABEL[next]}`);
    qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] });
  }

  const states: TournamentStatus[] = [
    "upcoming",
    "open_for_picks",
    "picks_closed",
    "live",
    "completed",
  ];

  return (
    <Card className="border-2" style={{ borderColor: "var(--gold)" }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          🏆 Global Tournament Lifecycle Status
          {saving && <span className="text-xs font-normal text-muted-foreground">(saving…)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={status}
          onValueChange={(v) => update(v as TournamentStatus)}
          className="grid grid-cols-2 md:grid-cols-5 gap-2"
        >
          {states.map((s) => {
            const active = status === s;
            return (
              <Label
                key={s}
                htmlFor={`tstat-${s}`}
                className={`flex items-center gap-2 px-3 py-3 rounded-md border-2 cursor-pointer transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-accent"
                }`}
              >
                <RadioGroupItem
                  id={`tstat-${s}`}
                  value={s}
                  className={active ? "border-primary-foreground" : ""}
                />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {TSTATUS_LABEL[s]}
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditTournamentDetailsForm({
  tournament,
}: {
  tournament: {
    id: string;
    name: string;
    location: string;
    logo_url: string | null;
    external_url?: string | null;
    start_date: string;
    end_date: string;
    submission_deadline: string;
  };
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: tournament.name,
    location: tournament.location,
    logo_url: tournament.logo_url ?? "",
    external_url: tournament.external_url ?? "",
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    submission_deadline: toDatetimeLocal(tournament.submission_deadline),
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.name ||
      !form.location ||
      !form.start_date ||
      !form.end_date ||
      !form.submission_deadline
    ) {
      toast.error("Fill in all required fields");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("tournaments")
      .update({
        name: form.name,
        location: form.location,
        logo_url: form.logo_url || null,
        external_url: form.external_url || null,
        start_date: form.start_date,
        end_date: form.end_date,
        submission_deadline: new Date(form.submission_deadline).toISOString(),
      })
      .eq("id", tournament.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tournament details updated");
    qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit Tournament Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Tournament Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Location / Venue</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                maxLength={120}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>Logo Image URL</Label>
            <div className="relative">
              <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="https://…"
                value={form.logo_url}
                onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>External Link URL</Label>
            <Input
              placeholder="https://… (official tournament website)"
              value={form.external_url}
              onChange={(e) => setForm({ ...form, external_url: e.target.value })}
            />
          </div>
          <div>
            <Label>Start Date</Label>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>End Date</Label>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>Submission Deadline (date & time)</Label>
            <Input
              type="datetime-local"
              value={form.submission_deadline}
              onChange={(e) => setForm({ ...form, submission_deadline: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving} className="gap-2">
              <Save className="size-4" />
              {saving ? "Updating…" : "Update Tournament Details"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const DEFAULT_BUCKET_SIZES: Record<number, number> = {
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  5: 0,
  6: 0,
  7: 0,
};

function normalizeBucketSizes(raw: unknown): Record<number, number> {
  const out: Record<number, number> = { ...DEFAULT_BUCKET_SIZES };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const b of BUCKETS) {
      const v = Number(
        (raw as Record<string, unknown>)[b] ?? (raw as Record<string, unknown>)[String(b)],
      );
      if (Number.isFinite(v) && v >= 0) out[b] = Math.floor(v);
    }
  }
  return out;
}

function BucketSizesEditor({
  tournamentId,
  rawSizes,
}: {
  tournamentId: string;
  rawSizes: unknown;
}) {
  const qc = useQueryClient();
  const sizes = useMemo(() => normalizeBucketSizes(rawSizes), [rawSizes]);
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft) return;
    const next: Record<number, number> = {};
    for (const b of BUCKETS) {
      const v = parseInt(draft[b] ?? "0", 10);
      next[b] = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    setSaving(true);
    const { error } = await supabase
      .from("tournaments")
      .update({ bucket_sizes: next as any })
      .eq("id", tournamentId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bucket sizes saved");
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span>Bucket Sizes</span>
          {draft ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Sizes"}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft(
                  Object.fromEntries(BUCKETS.map((b) => [b, String(sizes[b] ?? 0)])) as Record<
                    number,
                    string
                  >,
                )
              }
            >
              Edit Sizes
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {BUCKETS.map((b) => (
            <div key={b} className="border border-border rounded-md p-3 text-center bg-muted/30">
              <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                B{b}
              </div>
              {draft ? (
                <Input
                  type="number"
                  min={0}
                  value={draft[b]}
                  onChange={(e) => setDraft({ ...draft, [b]: e.target.value })}
                  className="mt-2 text-center h-8 text-sm"
                />
              ) : (
                <div className="font-semibold text-xl mt-1">{sizes[b]}</div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   Shared collapsible wrapper — same "Show ▼ / Hide ▲" convention
   used by Create Tournament and Bulk Import Users, extracted so
   we're not re-pasting the toggle button per section.
   ============================================================ */
function CollapsibleBlock({
  label,
  icon,
  defaultOpen = false,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left rounded-md border border-input bg-muted/30 px-3 py-2.5 hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </span>
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {open ? "Hide ▲" : "Show ▼"}
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ============================================================
   END OF ROUND EXPORT — golfer positions + Major7s scores as
   frozen per-round snapshots (R1..R4). Re-running the same round
   later returns the same file: golfer positions are read straight
   from position_rN/round_N (written once, never recalculated —
   see leaderboard-architecture.md §2.3), and Major7s scores are
   computed via the SAME computeRoundScores()/buildRoundPositionMap()
   used by the public leaderboard (src/lib/major7s-round-scoring.ts),
   so this panel can never diverge from what players see on-site.
   No round-toggle state is shared with the public leaderboard —
   this panel derives its own available-rounds set from whatever
   leaderboard data currently exists for the tournament.
   ============================================================ */

type LeaderboardRoundRow = ScoringLbRow & {
  country: string | null;
  // Live in-round detail — only populated once the ESPN ingest patch is
  // deployed and a fresh import runs; null on rows imported before that,
  // and null once a round finishes (ESPN stops setting these on status).
  today_thru: number | null;
  today_detail: string | null;
};

const EXPORT_ROUNDS: Round[] = ["r1", "r2", "r3", "r4"];

function slugifyForFilename(s: string): string {
  return s.replace(/\s+/g, "-").toLowerCase();
}

function downloadCsvFile(filename: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type PicksRowForScoring = {
  bucket: number;
  golfer_id: string | null;
  golfers: { golfer_name: string } | null;
  teams: { id: string; nickname: string } | null;
};

type TeamForScoring = { id: string; nickname: string; owner_user_id: string };

/**
 * Shared data fetch for anything that needs live-scoring inputs — used by
 * both EndOfRoundExportPanel and InProgressUpdatePanel. Same query keys as
 * before the extraction, so TanStack Query dedupes the network call when
 * both panels are mounted on the same tournament (no double-fetch).
 */
function useTournamentScoringData(tournamentId: string) {
  // Paginated per the 1,000-row Supabase cap — same pattern as the
  // Submissions tab below (183 teams × 7 picks = 1,281 rows).
  const { data: leaderboardRows = [] } = useQuery({
    queryKey: ["export-leaderboard-rows", tournamentId],
    queryFn: async () => {
      const PAGE = 1000;
      let all: LeaderboardRoundRow[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("tournament_leaderboard")
          .select(
            "id, golfer_id, espn_display_name, country, status_type, status_short_detail, position_r1, position_r2, position_r3, position_r4, round_1, round_2, round_3, round_4, today_thru, today_detail",
          )
          .eq("tournament_id", tournamentId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat((data ?? []) as LeaderboardRoundRow[]);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  // Picks with golfer + team names.
  const { data: picksRows = [] } = useQuery({
    queryKey: ["export-picks-rows", tournamentId],
    queryFn: async () => {
      const PAGE = 1000;
      let all: PicksRowForScoring[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("picks")
          .select("bucket, golfer_id, golfers ( golfer_name ), teams!inner ( id, nickname )")
          .eq("tournament_id", tournamentId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat((data ?? []) as unknown as PicksRowForScoring[]);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  // Teams — same source as the live Major7s view (tournament_scores joined
  // to teams), so callers count exactly the teams that participated.
  const { data: teamsForScoring = [] } = useQuery({
    queryKey: ["export-teams-for-scoring", tournamentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_scores")
        .select("team_id, teams ( id, nickname, owner_user_id )")
        .eq("tournament_id", tournamentId);
      if (error) throw error;
      return (data ?? [])
        .filter((r: any) => r.teams)
        .map((r: any) => ({
          id: r.teams.id as string,
          nickname: r.teams.nickname as string,
          owner_user_id: r.teams.owner_user_id as string,
        }));
    },
  });

  return { leaderboardRows, picksRows, teamsForScoring };
}

/** Rounds that actually have position data, earliest first. */
function computeAvailableRounds(leaderboardRows: LeaderboardRoundRow[]): Round[] {
  const set = new Set<Round>();
  for (const row of leaderboardRows) {
    if (row.position_r1 != null) set.add("r1");
    if (row.position_r2 != null) set.add("r2");
    if (row.position_r3 != null) set.add("r3");
    if (row.position_r4 != null) set.add("r4");
  }
  return EXPORT_ROUNDS.filter((r) => set.has(r));
}

function EndOfRoundExportPanel({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const { leaderboardRows, picksRows, teamsForScoring } = useTournamentScoringData(tournamentId);

  // Rounds that actually have data — same "hide, don't disable-and-show"
  // convention as the public RoundToggle component.
  const availableRounds = useMemo(() => computeAvailableRounds(leaderboardRows), [leaderboardRows]);

  const [selectedRound, setSelectedRound] = useState<Round | null>(null);
  const activeRound: Round | null =
    selectedRound && availableRounds.includes(selectedRound)
      ? selectedRound
      : (availableRounds[availableRounds.length - 1] ?? null);

  // Scored via the shared computeRoundScores() — identical logic to the
  // public leaderboard, including recomputed cumulative-stroke positions,
  // WD/CUT handling, carry-forward, and best-5-of-7 SCR ranking.
  const teamRowsForRound = useMemo<RoundTeamScore[]>(() => {
    if (!activeRound || teamsForScoring.length === 0) return [];
    const picksForScoring = picksRows
      .filter((p) => p.teams && p.golfer_id)
      .map((p) => ({ team_id: p.teams!.id, bucket: p.bucket, golfer_id: p.golfer_id as string }));
    return computeRoundScores(teamsForScoring, picksForScoring, leaderboardRows, activeRound);
  }, [activeRound, teamsForScoring, picksRows, leaderboardRows]);

  function exportGolferPositions() {
    if (!activeRound) return;
    const roundCols = EXPORT_ROUNDS.slice(0, EXPORT_ROUNDS.indexOf(activeRound) + 1);

    // Recomputed SCR positions, NOT the raw position_rN snapshot columns.
    // ESPN's position_rN is assigned sequentially as each golfer finishes
    // and does not get corrected for ties once the round completes — two
    // golfers on the same score can show different position_rN values.
    // buildRoundPositionMap() recomputes true Standard Competition Ranking
    // from cumulative strokes (same function the Major7s scoring above
    // already uses), so this file and the scoring file agree with each
    // other and with reality.
    const inProgressRound = getInProgressRound(leaderboardRows);
    const posMapsByRound = new Map(
      roundCols.map((r) => [r, buildRoundPositionMap(leaderboardRows, r, inProgressRound)]),
    );

    const headers = [
      "Golfer",
      "Country",
      "Status",
      ...roundCols.flatMap((r) => [`${r.toUpperCase()} Position`, `${r.toUpperCase()} Strokes`]),
    ];
    const lines = [headers.join(",")];
    for (const row of leaderboardRows) {
      const strokes = [row.round_1, row.round_2, row.round_3, row.round_4];
      const status = isWithdrawn(row) ? "WD" : row.status_type === "STATUS_CUT" ? "CUT" : "Active";
      const cells = [
        `"${row.espn_display_name}"`,
        row.country ?? "",
        status,
        ...roundCols.flatMap((r, i) => {
          const pos = posMapsByRound.get(r)!.get(row.golfer_id ?? row.id) ?? "";
          return [pos, strokes[i] ?? ""];
        }),
      ];
      lines.push(cells.join(","));
    }
    downloadCsvFile(`golfer-positions-${activeRound}-${slugifyForFilename(tournamentName)}.csv`, lines);
  }

  function exportMajor7sScores() {
    if (!activeRound) return;
    const headers = [
      "Pos",
      "Team",
      "Thru Cut",
      `${activeRound.toUpperCase()} Points`,
      ...[1, 2, 3, 4, 5, 6, 7].map((b) => `B${b}`),
    ];
    const lines = [headers.join(",")];
    for (const team of teamRowsForRound) {
      const picksByBucket = new Map(team.picks.map((p) => [p.bucket, p.golfer_name]));
      const cells = [
        team.is_tie ? `T${team.position}` : `${team.position}`,
        `"${team.nickname}"`,
        team.thru_cut ?? "",
        team.total,
        ...[1, 2, 3, 4, 5, 6, 7].map((b) => `"${picksByBucket.get(b) ?? "—"}"`),
      ];
      lines.push(cells.join(","));
    }
    downloadCsvFile(`major7s-scores-${activeRound}-${slugifyForFilename(tournamentName)}.csv`, lines);
  }

  return (
    <Card className="border-2" style={{ borderColor: "var(--gold)" }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="size-4" />
          End of Round Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Select a round to freeze a snapshot through that point. Re-running the same round later returns the
          same file.
        </p>

        {availableRounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rounds have ESPN data yet — import a leaderboard first.
          </p>
        ) : (
          <>
            <div>
              <Label className="text-xs uppercase tracking-widest">Round</Label>
              <div className="flex gap-2 mt-2">
                {EXPORT_ROUNDS.filter((r) => availableRounds.includes(r)).map((r) => {
                  const active = activeRound === r;
                  return (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => setSelectedRound(r)}
                    >
                      {r.toUpperCase()}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={exportGolferPositions} disabled={!activeRound}>
                <Download className="size-3.5" /> Golfer positions through {activeRound?.toUpperCase()}
              </Button>
              <Button size="sm" variant="outline" onClick={exportMajor7sScores} disabled={!activeRound}>
                <Download className="size-3.5" /> Major7s scores through {activeRound?.toUpperCase()}
              </Button>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Preview — top 10 of {teamRowsForRound.length} teams ({activeRound?.toUpperCase()})
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pos</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Thru Cut</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamRowsForRound.slice(0, 10).map((team) => (
                      <TableRow key={team.team_id}>
                        <TableCell className="text-sm">
                          {team.is_tie ? `T${team.position}` : team.position}
                        </TableCell>
                        <TableCell className="text-sm">{team.nickname}</TableCell>
                        <TableCell className="text-right text-sm">{team.thru_cut ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{team.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   IN-PROGRESS UPDATE — WhatsApp-ready live summary generated by
   diffing the current live snapshot against the last saved one.
   Reuses the same computeRoundScores/buildRoundPositionMap as the
   leaderboard and the export panel above, so "live score" here
   means exactly what the public Major7s view shows right now.

   Data note: tournament_leaderboard only stores round totals and
   cumulative per-round positions — no hole-by-hole scoring. Golfer
   callouts are therefore position-movement based ("now 4th, was
   13th"), not shot commentary. Prize positions are fixed at top 3
   including ties (PRIZE_POSITIONS below) per current club rules —
   revisit if that ever needs to be admin-configurable.

   Persistence: baseline snapshots are stored in a new Supabase
   table, tournament_live_snapshots (see the accompanying SQL
   migration — this needs to be run in the Supabase SQL editor
   before this panel will work; it hasn't been run automatically).
   ============================================================ */

const PRIZE_POSITIONS = 3;

// Per-golfer status for today's round. Derived entirely from status_type,
// which is already ingested by the ESPN import (no schema change needed
// for this). What's NOT available: hole-by-hole detail — how many holes
// played today, today's score to par. tournament_leaderboard only stores
// round_1..4 totals and position_r1..4, no "thru" column, so "Still in
// control" callouts below say a golfer is "still out" but can't say
// "-10 thru 14" the way a live scoring feed could. If ESPN's raw payload
// carries that per-golfer (it likely does, in linescores[].thru /
// .scoreToPar for the current period), it would need a new column and an
// ingest-function change to persist it — a bigger change than this panel,
// not attempted here.
type GolferRoundStatus = "NOT_STARTED" | "IN_PROGRESS" | "FINISHED" | "CUT" | "WD";
const STILL_OUT_STATUSES: GolferRoundStatus[] = ["NOT_STARTED", "IN_PROGRESS"];

function golferStatusFromRow(row: LeaderboardRoundRow): GolferRoundStatus {
  if (isWithdrawn(row)) return "WD";
  if (row.status_type === "STATUS_CUT") return "CUT";
  if (row.status_type === "STATUS_IN_PROGRESS") return "IN_PROGRESS";
  if (row.status_type === "STATUS_FINISH") return "FINISHED";
  return "NOT_STARTED";
}

interface SnapshotPick {
  golfer_id: string;
  golfer_name: string;
  bucket: number;
  points: number;
  counted: boolean;
  roundStatus: GolferRoundStatus;
  // e.g. "E(4)", "-3(14)" — null unless this golfer's round is currently
  // in progress AND the ingest was run after the today_thru/today_detail
  // migration + function patch. See LeaderboardRoundRow.
  todayDetail: string | null;
  // Raw strokes for today's round (round_1..4, whichever matches the
  // snapshot's round), used for the FINISHED case — "(62)", never a
  // score-to-par figure. Null while in progress/not started (the actual
  // round_N column isn't populated by ESPN until the round is complete).
  todayStrokes: number | null;
}

interface SnapshotTeam {
  team_id: string;
  nickname: string;
  total: number;
  position: number;
  is_tie: boolean;
  thru_cut: number | null;
  picks: SnapshotPick[];
}

interface SnapshotGolfer {
  key: string; // golfer_id, or the leaderboard row id for unmatched golfers
  name: string;
  position: number;
  roundStatus: GolferRoundStatus;
  todayDetail: string | null;
  todayStrokes: number | null;
}

interface LiveSnapshot {
  captured_at: string;
  round: Round;
  teams: SnapshotTeam[];
  golfers: SnapshotGolfer[];
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

/** Positions that more than one entity shares — powers the T-prefix. */
function buildTieSet(values: number[]): Set<number> {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ties = new Set<number>();
  for (const [v, c] of counts) if (c > 1) ties.add(v);
  return ties;
}

/** "T4" when tied, otherwise ordinal ("4th") — matches how ties read on the public leaderboard. */
function golferPosLabel(position: number, tieSet: Set<number>): string {
  return tieSet.has(position) ? `T${position}` : ordinal(position);
}

function teamPosLabel(team: SnapshotTeam): string {
  return team.is_tie ? `T${team.position}` : ordinal(team.position);
}

function buildLiveSnapshot(
  leaderboardRows: LeaderboardRoundRow[],
  picksRows: PicksRowForScoring[],
  teamsForScoring: TeamForScoring[],
): LiveSnapshot | null {
  const availableRounds = computeAvailableRounds(leaderboardRows);
  const round = availableRounds[availableRounds.length - 1];
  if (!round) return null;

  const inProgressRound = getInProgressRound(leaderboardRows);
  const posMap = buildRoundPositionMap(leaderboardRows, round, inProgressRound);

  // round_1..4 raw stroke total for whichever round this snapshot covers —
  // this is a real stroke count ("62"), only populated by ESPN once that
  // round is finished. Used for the FINISHED-golfer "(62)" suffix; never
  // used for IN_PROGRESS golfers, who show live score-to-par instead.
  const strokesForRound = (row: LeaderboardRoundRow): number | null => {
    switch (round) {
      case "r1":
        return row.round_1;
      case "r2":
        return row.round_2;
      case "r3":
        return row.round_3;
      case "r4":
        return row.round_4;
      default:
        return null;
    }
  };

  const statusByGolferId = new Map<string, GolferRoundStatus>();
  const detailByGolferId = new Map<string, string | null>();
  const strokesByGolferId = new Map<string, number | null>();
  for (const row of leaderboardRows) {
    if (row.golfer_id) {
      statusByGolferId.set(row.golfer_id, golferStatusFromRow(row));
      detailByGolferId.set(row.golfer_id, row.today_detail);
      strokesByGolferId.set(row.golfer_id, strokesForRound(row));
    }
  }

  const picksForScoring = picksRows
    .filter((p) => p.teams && p.golfer_id)
    .map((p) => ({ team_id: p.teams!.id, bucket: p.bucket, golfer_id: p.golfer_id as string }));

  const teamScores = computeRoundScores(teamsForScoring, picksForScoring, leaderboardRows, round);

  const teams: SnapshotTeam[] = teamScores.map((t) => ({
    team_id: t.team_id,
    nickname: t.nickname,
    total: t.total,
    position: t.position,
    is_tie: t.is_tie,
    thru_cut: t.thru_cut,
    picks: t.picks.map((p) => ({
      golfer_id: p.golfer_id,
      golfer_name: p.golfer_name,
      bucket: p.bucket,
      points: p.points,
      counted: p.counted,
      roundStatus: statusByGolferId.get(p.golfer_id) ?? "NOT_STARTED",
      todayDetail: detailByGolferId.get(p.golfer_id) ?? null,
      todayStrokes: strokesByGolferId.get(p.golfer_id) ?? null,
    })),
  }));

  const golfers: SnapshotGolfer[] = [];
  for (const row of leaderboardRows) {
    const key = row.golfer_id ?? row.id;
    const pos = posMap.get(key);
    if (pos == null) continue;
    golfers.push({
      key,
      name: row.espn_display_name,
      position: pos,
      roundStatus: golferStatusFromRow(row),
      todayDetail: row.today_detail,
      todayStrokes: strokesForRound(row),
    });
  }

  return { captured_at: new Date().toISOString(), round, teams, golfers };
}

async function fetchLatestLiveSnapshot(tournamentId: string): Promise<LiveSnapshot | null> {
  const { data, error } = await (supabase as any)
    .from("tournament_live_snapshots")
    .select("captured_at, round, snapshot")
    .eq("tournament_id", tournamentId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const body = data.snapshot as { teams: SnapshotTeam[]; golfers: SnapshotGolfer[] };
  return {
    captured_at: data.captured_at as string,
    round: data.round as Round,
    teams: body.teams,
    golfers: body.golfers,
  };
}

async function saveLiveSnapshot(tournamentId: string, snapshot: LiveSnapshot) {
  const { error } = await (supabase as any).from("tournament_live_snapshots").insert({
    tournament_id: tournamentId,
    captured_at: snapshot.captured_at,
    round: snapshot.round,
    snapshot: { teams: snapshot.teams, golfers: snapshot.golfers },
  });
  if (error) throw error;
}

// --- Section builders. Each returns null when there's nothing to report,
// so the caller can omit the section entirely per the formatting spec. ---

function leaderChangeSection(
  current: LiveSnapshot,
  previous: LiveSnapshot,
  currTies: Set<number>,
  prevTies: Set<number>,
): string | null {
  const currLeaders = current.teams.filter((t) => t.position === 1);
  const prevLeaders = previous.teams.filter((t) => t.position === 1);
  const currIds = new Set(currLeaders.map((t) => t.team_id));
  const prevIds = new Set(prevLeaders.map((t) => t.team_id));
  const unchanged = currIds.size === prevIds.size && [...currIds].every((id) => prevIds.has(id));
  if (unchanged || currLeaders.length === 0) return null;

  const newLeaderNames = currLeaders.map((t) => t.nickname).join(" & ");
  const overtookNames = prevLeaders.map((t) => t.nickname).join(" & ") || "the field";
  const leaderTotal = currLeaders[0].total;

  const drivers: string[] = [];
  for (const team of currLeaders) {
    const prevTeam = previous.teams.find((t) => t.team_id === team.team_id);
    if (!prevTeam) continue;
    const swings: {
      name: string;
      delta: number;
      pos: number;
      prevPos: number;
      roundStatus: GolferRoundStatus;
      todayDetail: string | null;
      todayStrokes: number | null;
    }[] = [];
    for (const pick of team.picks) {
      if (!pick.counted) continue;
      const prevPick = prevTeam.picks.find((p) => p.golfer_id === pick.golfer_id);
      if (!prevPick) continue;
      const delta = prevPick.points - pick.points; // positive = climbed
      if (delta > 0)
        swings.push({
          name: pick.golfer_name,
          delta,
          pos: pick.points,
          prevPos: prevPick.points,
          roundStatus: pick.roundStatus,
          todayDetail: pick.todayDetail,
          todayStrokes: pick.todayStrokes,
        });
    }
    swings.sort((a, b) => b.delta - a.delta);
    for (const s of swings.slice(0, 2)) {
      const todayLabel = golferTodayLabel(s.roundStatus, s.todayDetail, s.todayStrokes);
      drivers.push(`${s.name}${todayLabel} now ${golferPosLabel(s.pos, currTies)} (was ${golferPosLabel(s.prevPos, prevTies)})`);
    }
  }

  const driverText = drivers.length > 0 ? ` ${drivers.join(", ")}.` : "";
  return `👑 *New leader:* ${newLeaderNames} moves to ${leaderTotal}, overtaking ${overtookNames}.${driverText}`;
}

function scoreToBeatSection(current: LiveSnapshot): string {
  const totals = [...new Set(current.teams.map((t) => t.total))].sort((a, b) => a - b);
  const leaderTotal = totals[0];
  const leaders = current.teams.filter((t) => t.total === leaderTotal);
  const leaderNames = leaders.map((t) => t.nickname).join(" & ");
  const parts: string[] = [];
  if (totals[1] != null) parts.push(`${totals[1] - leaderTotal} clear of 2nd`);
  if (totals[2] != null) parts.push(`${totals[2] - leaderTotal} clear of 3rd`);
  const gapText = parts.length > 0 ? `, ${parts.join(", ")}` : "";
  return `*Score to beat:* ${leaderNames} on ${leaderTotal}${gapText}.`;
}

function pickDriverLine(
  team: SnapshotTeam,
  prevTeam: SnapshotTeam,
  currTies: Set<number>,
  prevTies: Set<number>,
): string {
  const swings: {
    name: string;
    delta: number;
    pos: number;
    prevPos: number;
    roundStatus: GolferRoundStatus;
    todayDetail: string | null;
    todayStrokes: number | null;
  }[] = [];
  for (const pick of team.picks) {
    const prevPick = prevTeam.picks.find((p) => p.golfer_id === pick.golfer_id);
    if (!prevPick) continue;
    const delta = prevPick.points - pick.points; // positive = climbed
    if (delta !== 0)
      swings.push({
        name: pick.golfer_name,
        delta,
        pos: pick.points,
        prevPos: prevPick.points,
        roundStatus: pick.roundStatus,
        todayDetail: pick.todayDetail,
        todayStrokes: pick.todayStrokes,
      });
  }
  swings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = swings[0];
  if (!top) return "";
  const todayLabel = golferTodayLabel(top.roundStatus, top.todayDetail, top.todayStrokes);
  return `${top.name}${todayLabel} now ${golferPosLabel(top.pos, currTies)} (was ${golferPosLabel(top.prevPos, prevTies)})`;
}

function riserFallerSections(
  current: LiveSnapshot,
  previous: LiveSnapshot,
  currTies: Set<number>,
  prevTies: Set<number>,
): { risers: string | null; fallers: string | null } {
  const prevByTeam = new Map(previous.teams.map((t) => [t.team_id, t]));
  const deltas: { team: SnapshotTeam; prevTeam: SnapshotTeam; delta: number }[] = [];
  for (const team of current.teams) {
    const prevTeam = prevByTeam.get(team.team_id);
    if (!prevTeam) continue;
    const delta = prevTeam.total - team.total; // positive = improved (lower score is better)
    if (delta !== 0) deltas.push({ team, prevTeam, delta });
  }

  const risers = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const fallers = deltas
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);

  const risersText =
    risers.length > 0
      ? `📈 *Biggest risers*\n\n${risers
          .map((r) => {
            const driver = pickDriverLine(r.team, r.prevTeam, currTies, prevTies);
            return `- ${r.team.nickname}: ${r.prevTeam.total} to ${r.team.total} (-${r.delta})${driver ? ` — ${driver}` : ""}`;
          })
          .join("\n")}`
      : null;

  const fallersText =
    fallers.length > 0
      ? `📉 *Biggest fallers*\n\n${fallers
          .map((f) => {
            const driver = pickDriverLine(f.team, f.prevTeam, currTies, prevTies);
            return `- ${f.team.nickname}: ${f.prevTeam.total} to ${f.team.total} (+${-f.delta})${driver ? ` — ${driver}` : ""}`;
          })
          .join("\n")}`
      : null;

  return { risers: risersText, fallers: fallersText };
}

function topNWatchSection(
  current: LiveSnapshot,
  previous: LiveSnapshot,
  n: number,
  label: string,
): string | null {
  const currTop = new Set(current.teams.filter((t) => t.position <= n).map((t) => t.team_id));
  const prevTop = new Set(previous.teams.filter((t) => t.position <= n).map((t) => t.team_id));

  const inTeams = current.teams.filter((t) => currTop.has(t.team_id) && !prevTop.has(t.team_id));
  const outTeams = previous.teams.filter((t) => prevTop.has(t.team_id) && !currTop.has(t.team_id));

  if (inTeams.length === 0 && outTeams.length === 0) return null;

  const lines: string[] = [`🏆 *${label}*`];
  for (const t of inTeams) {
    const prevTeam = previous.teams.find((p) => p.team_id === t.team_id);
    lines.push(`IN: ${t.nickname}, now ${teamPosLabel(t)}${prevTeam ? `, was ${teamPosLabel(prevTeam)}` : ""}`);
  }
  for (const t of outTeams) {
    const currTeam = current.teams.find((c) => c.team_id === t.team_id);
    lines.push(`OUT: ${t.nickname}, now ${currTeam ? teamPosLabel(currTeam) : "outside the field"}, was ${teamPosLabel(t)}`);
  }

  const cutoffTeam = current.teams.find((t) => t.position === n);
  const outsideNow = current.teams.filter((t) => t.position > n);
  if (cutoffTeam && outsideNow.length > 0) {
    const bubble = [...outsideNow].sort((a, b) => a.total - b.total)[0];
    const gap = bubble.total - cutoffTeam.total;
    lines.push(`On the bubble: ${bubble.nickname} just ${gap} point${gap === 1 ? "" : "s"} off ${ordinal(n)}`);
  }

  return lines.join("\n");
}

function prizeLineSection(current: LiveSnapshot): string {
  const holders = current.teams.filter((t) => t.position <= PRIZE_POSITIONS);
  const holdersByPos = new Map<number, SnapshotTeam[]>();
  for (const t of holders) {
    const arr = holdersByPos.get(t.position) ?? [];
    arr.push(t);
    holdersByPos.set(t.position, arr);
  }
  const lines: string[] = [`💰 *Prize line (top ${PRIZE_POSITIONS})*`];
  for (const pos of [...holdersByPos.keys()].sort((a, b) => a - b)) {
    const teamsAtPos = holdersByPos.get(pos)!;
    const label = teamsAtPos.length > 1 ? `T${pos}` : `${pos}`;
    lines.push(`${label}: ${teamsAtPos.map((t) => `${t.nickname} (${t.total})`).join(", ")}`);
  }
  const chasers = current.teams.filter((t) => t.position > PRIZE_POSITIONS);
  const cutoffTotal = holders.length > 0 ? Math.max(...holders.map((t) => t.total)) : null;
  if (chasers.length > 0 && cutoffTotal != null) {
    const chaser = [...chasers].sort((a, b) => a.total - b.total)[0];
    const gap = chaser.total - cutoffTotal;
    lines.push(`Chasing: ${chaser.nickname}, ${gap} point${gap === 1 ? "" : "s"} off the money`);
  }
  return lines.join("\n");
}

function golferHeatCheckSection(
  current: LiveSnapshot,
  previous: LiveSnapshot,
  picksRows: PicksRowForScoring[],
  currTies: Set<number>,
  prevTies: Set<number>,
): string | null {
  const prevByKey = new Map(previous.golfers.map((g) => [g.key, g]));
  let best: {
    name: string;
    delta: number;
    pos: number;
    prevPos: number;
    key: string;
    roundStatus: GolferRoundStatus;
    todayDetail: string | null;
    todayStrokes: number | null;
  } | null = null;
  for (const g of current.golfers) {
    const prev = prevByKey.get(g.key);
    if (!prev) continue;
    const delta = prev.position - g.position; // positive = climbed
    if (delta > 0 && (!best || delta > best.delta)) {
      best = {
        name: g.name,
        delta,
        pos: g.position,
        prevPos: prev.position,
        key: g.key,
        roundStatus: g.roundStatus,
        todayDetail: g.todayDetail,
        todayStrokes: g.todayStrokes,
      };
    }
  }
  if (!best) return null;

  const teamCount = new Set(
    picksRows.filter((p) => p.golfer_id === best!.key && p.teams).map((p) => p.teams!.id),
  ).size;

  const todayLabel = golferTodayLabel(best.roundStatus, best.todayDetail, best.todayStrokes);
  return `🔥 *Golfer heat check:* ${best.name}${todayLabel} up to ${golferPosLabel(best.pos, currTies)} from ${golferPosLabel(best.prevPos, prevTies)} — in ${teamCount} Major7s team${teamCount === 1 ? "" : "s"}.`;
}

/**
 * Parses ESPN's "-5(17)" / "E(4)" / "+2(17)" today_detail format into its
 * parts. The leading token is a score-to-par notation ("-5", "E", "+2") —
 * never reused as a plain count elsewhere in this file, since a bare "+3"
 * in golf output reads as "3 over par", not "3 more of something".
 */
function parseTodayDetail(raw: string | null | undefined): { label: string; thru: number; scoreToPar: number } | null {
  if (!raw) return null;
  const m = raw.match(/^([+-]?\d+|E)\((\d+)\)$/);
  if (!m) return null;
  return { label: m[1], thru: parseInt(m[2], 10), scoreToPar: m[1] === "E" ? 0 : parseInt(m[1], 10) };
}

function formatTodayDetail(raw: string | null | undefined): string | null {
  const parsed = parseTodayDetail(raw);
  return parsed ? `currently ${parsed.label} thru ${parsed.thru}` : null;
}

/**
 * Today's-round performance suffix for whenever a golfer is named in the
 * update text, e.g. "Si Woo Kim (-1 thru 2)" while live, or
 * "Si Woo Kim (62)" once finished. Deliberately raw strokes when finished
 * — not score-to-par — per the request that a bare "(-3)" reads as scoring
 * notation and gets confused with position-movement figures elsewhere in
 * the same message. Empty string (no suffix) for NOT_STARTED/CUT/WD, or
 * when the underlying data isn't available yet.
 */
function golferTodayLabel(
  roundStatus: GolferRoundStatus,
  todayDetail: string | null,
  todayStrokes: number | null,
): string {
  if (roundStatus === "IN_PROGRESS") {
    const parsed = parseTodayDetail(todayDetail);
    return parsed ? ` (${parsed.label} thru ${parsed.thru})` : "";
  }
  if (roundStatus === "FINISHED") {
    return todayStrokes != null ? ` (${todayStrokes})` : "";
  }
  return "";
}

/**
 * Today's best live/finished rounds across the whole field, sourced from
 * today_detail (see the migration + espn-leaderboard.functions.ts patch).
 * Includes anyone ESPN is currently reporting a today score for, whether
 * their round is finished or still in progress — "today" means today's
 * round, not "right now." Current-state only, no previous snapshot needed.
 */
function todayLowScoresSection(current: LiveSnapshot, picksRows: PicksRowForScoring[]): string | null {
  const parsed = current.golfers
    .map((g) => ({ g, detail: parseTodayDetail(g.todayDetail) }))
    .filter((x): x is { g: SnapshotGolfer; detail: { label: string; thru: number; scoreToPar: number } } => x.detail !== null);
  if (parsed.length === 0) return null;

  parsed.sort((a, b) => a.detail.scoreToPar - b.detail.scoreToPar);
  const top = parsed.slice(0, 5);

  const lines = top.map(({ g, detail }) => {
    const owners = [...new Set(picksRows.filter((p) => p.golfer_id === g.key && p.teams).map((p) => p.teams!.nickname))];
    const ownerText =
      owners.length === 0
        ? "not owned"
        : owners.length > GOLFER_MOVER_OWNER_LIST_LIMIT
          ? `owned by ${owners.length} teams`
          : `owned by ${owners.join(", ")}`;
    return `- ${g.name}: ${detail.label} thru ${detail.thru} — ${ownerText}`;
  });

  return `🏌️ *Best scores today*\n\n${lines.join("\n")}`;
}

/**
 * Locked in / multiple live / one to watch — scoped to the current top 10.
 * Doesn't need a previous snapshot; it's current-state only.
 *
 * Three distinct buckets rather than one blended "still out" list:
 * - Locked in: nobody left to play — score for today is final regardless
 *   of what anyone else does.
 * - Multiple golfers live: 2+ picks actively STATUS_IN_PROGRESS right now —
 *   the volatile case, score could move at any moment.
 * - One to watch: exactly one golfer in progress (shown with live detail
 *   when today_detail is available), or only not-yet-started picks remain.
 */
const STATUS_SECTION_SCOPE = 10;

function lockedInSection(current: LiveSnapshot): string | null {
  const scope = [...current.teams]
    .filter((t) => t.position <= STATUS_SECTION_SCOPE)
    .sort((a, b) => a.position - b.position);
  if (scope.length === 0) return null;

  const lockedLines: string[] = [];
  const multipleLiveLines: string[] = [];
  const oneToWatchLines: string[] = [];

  for (const team of scope) {
    const inProgress = team.picks.filter((p) => p.roundStatus === "IN_PROGRESS");
    const notStarted = team.picks.filter((p) => p.roundStatus === "NOT_STARTED");

    if (inProgress.length === 0 && notStarted.length === 0) {
      lockedLines.push(`- ${team.nickname} (${teamPosLabel(team)}) — all 7 golfers finished`);
      continue;
    }

    if (inProgress.length >= 2) {
      const names = inProgress.map((p) => {
        const detail = parseTodayDetail(p.todayDetail);
        return detail ? `${p.golfer_name} (${detail.label} thru ${detail.thru})` : p.golfer_name;
      });
      multipleLiveLines.push(`- ${team.nickname} (${teamPosLabel(team)}) — ${inProgress.length} live: ${names.join(", ")}`);
      continue;
    }

    if (inProgress.length === 1) {
      const detail = formatTodayDetail(inProgress[0].todayDetail);
      const teeNote = notStarted.length > 0 ? `, ${notStarted.length} more to tee off` : "";
      oneToWatchLines.push(
        `- ${team.nickname} (${teamPosLabel(team)}) — ${inProgress[0].golfer_name} still out${detail ? `, ${detail}` : ""}${teeNote}`,
      );
      continue;
    }

    oneToWatchLines.push(
      `- ${team.nickname} (${teamPosLabel(team)}) — ${notStarted.length} golfer${notStarted.length === 1 ? "" : "s"} yet to tee off`,
    );
  }

  const sections: string[] = [];
  if (lockedLines.length > 0) {
    sections.push(`🔒 *Locked in — score is final unless overtaken*\n\n${lockedLines.join("\n")}`);
  }
  if (multipleLiveLines.length > 0) {
    sections.push(`🔴 *Multiple golfers live*\n\n${multipleLiveLines.join("\n")}`);
  }
  if (oneToWatchLines.length > 0) {
    sections.push(`⛳ *Still in control*\n\n${oneToWatchLines.join("\n")}`);
  }
  return sections.length > 0 ? sections.join("\n\n") : null;
}

/**
 * Golfer Movers (item 9). Position-movement threshold only — the spec also
 * asked for "or scored an eagle/multiple birdies in the window", which
 * isn't derivable from this schema (no hole-by-hole scoring stored), so
 * that half of the trigger is intentionally not implemented.
 */
const GOLFER_MOVER_THRESHOLD = 3;
const GOLFER_MOVER_CAP = 6;
const GOLFER_MOVER_OWNER_LIST_LIMIT = 5;

function golferMoversSection(
  current: LiveSnapshot,
  previous: LiveSnapshot,
  picksRows: PicksRowForScoring[],
  currTies: Set<number>,
  prevTies: Set<number>,
): string | null {
  const prevByKey = new Map(previous.golfers.map((g) => [g.key, g]));
  const movers: {
    name: string;
    delta: number;
    pos: number;
    prevPos: number;
    key: string;
    roundStatus: GolferRoundStatus;
    todayDetail: string | null;
    todayStrokes: number | null;
  }[] = [];
  for (const g of current.golfers) {
    const prev = prevByKey.get(g.key);
    if (!prev) continue;
    const delta = prev.position - g.position; // positive = climbed, negative = dropped
    if (Math.abs(delta) >= GOLFER_MOVER_THRESHOLD) {
      movers.push({
        name: g.name,
        delta,
        pos: g.position,
        prevPos: prev.position,
        key: g.key,
        roundStatus: g.roundStatus,
        todayDetail: g.todayDetail,
        todayStrokes: g.todayStrokes,
      });
    }
  }
  if (movers.length === 0) return null;

  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = movers.slice(0, GOLFER_MOVER_CAP);

  const lines = top.map((m) => {
    const owners = [
      ...new Set(picksRows.filter((p) => p.golfer_id === m.key && p.teams).map((p) => p.teams!.nickname)),
    ];
    const ownerText =
      owners.length === 0
        ? "not currently owned"
        : owners.length > GOLFER_MOVER_OWNER_LIST_LIMIT
          ? `owned by ${owners.length} teams`
          : `owned by ${owners.join(", ")}`;
    const todayLabel = golferTodayLabel(m.roundStatus, m.todayDetail, m.todayStrokes);
    return `- ${m.name}${todayLabel}: ${golferPosLabel(m.prevPos, prevTies)} → ${golferPosLabel(m.pos, currTies)} — ${ownerText}`;
  });

  return `⛳ *Golfer movers*\n\n${lines.join("\n")}`;
}

function generateLiveUpdateText(
  current: LiveSnapshot,
  previous: LiveSnapshot | null,
  picksRows: PicksRowForScoring[],
): string {
  const timeLabel = new Date(current.captured_at).toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  });
  const sections: string[] = [`🔴 *LIVE MAJOR7S UPDATE — ${timeLabel}*`];
  const currTies = buildTieSet(current.golfers.map((g) => g.position));

  if (!previous) {
    sections.push(`_Baseline captured. Run again once golfers move for the next update._`);
    sections.push(scoreToBeatSection(current));
    const lowScores = todayLowScoresSection(current, picksRows);
    if (lowScores) sections.push(lowScores);
    const locked = lockedInSection(current);
    if (locked) sections.push(locked);
    sections.push(prizeLineSection(current));
    return sections.join("\n\n");
  }

  const prevTies = buildTieSet(previous.golfers.map((g) => g.position));

  const leaderSection = leaderChangeSection(current, previous, currTies, prevTies);
  if (leaderSection) sections.push(leaderSection);

  sections.push(scoreToBeatSection(current));

  const { risers, fallers } = riserFallerSections(current, previous, currTies, prevTies);
  if (risers) sections.push(risers);
  if (fallers) sections.push(fallers);

  const top5 = topNWatchSection(current, previous, 5, "Top 5 watch");
  if (top5) sections.push(top5);

  const top10 = topNWatchSection(current, previous, 10, "Top 10 watch");
  if (top10) sections.push(top10);

  sections.push(prizeLineSection(current));

  const heat = golferHeatCheckSection(current, previous, picksRows, currTies, prevTies);
  if (heat) sections.push(heat);

  const lowScores = todayLowScoresSection(current, picksRows);
  if (lowScores) sections.push(lowScores);

  const locked = lockedInSection(current);
  if (locked) sections.push(locked);

  const movers = golferMoversSection(current, previous, picksRows, currTies, prevTies);
  if (movers) sections.push(movers);

  return sections.join("\n\n");
}

function InProgressUpdatePanel({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const { leaderboardRows, picksRows, teamsForScoring } = useTournamentScoringData(tournamentId);
  const [outputText, setOutputText] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: previousSnapshot, refetch: refetchPreviousSnapshot } = useQuery({
    queryKey: ["live-snapshot-latest", tournamentId],
    queryFn: () => fetchLatestLiveSnapshot(tournamentId),
  });

  async function handleGenerate() {
    setBusy(true);
    try {
      const current = buildLiveSnapshot(leaderboardRows, picksRows, teamsForScoring);
      if (!current) {
        toast.error("No live leaderboard data yet — import ESPN data first.");
        return;
      }
      const text = generateLiveUpdateText(current, previousSnapshot ?? null, picksRows);
      setOutputText(text);
      await saveLiveSnapshot(tournamentId, current);
      await refetchPreviousSnapshot();
      toast.success("Update generated — baseline saved for next time");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate update");
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    if (!outputText) return;
    navigator.clipboard.writeText(outputText).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Clipboard copy failed"),
    );
  }

  return (
    <Card className="border-2" style={{ borderColor: "var(--gold)" }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="size-4" />
          In-Progress Update
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Compares the current live leaderboard against the last saved snapshot and drafts a WhatsApp-ready
          update. Each run saves a new baseline for next time.
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={handleGenerate} disabled={busy}>
            {busy ? "Generating…" : "Generate Update"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy} disabled={!outputText}>
            <Copy className="size-3.5" /> Copy to Clipboard
          </Button>
          {previousSnapshot && (
            <span className="text-xs text-muted-foreground sm:ml-auto">
              Last baseline: {new Date(previousSnapshot.captured_at).toLocaleString("en-GB")}
            </span>
          )}
        </div>

        <Textarea
          readOnly
          value={outputText}
          placeholder="Click Generate Update to draft the WhatsApp update…"
          className="min-h-[280px] max-h-[480px] font-mono text-sm"
        />
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
      const PAGE = 1000;
      let all: Array<{
        id: string;
        nickname: string;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
      }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, nickname, email, first_name, last_name, phone")
          .eq("status", "approved")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data ?? []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  // Embedded join: picks → teams (FK exists) and picks → golfers (FK exists)
  // Paginated to avoid the Supabase 1000-row default cap. With 183 teams × 7
  // buckets = 1,281 rows, a single un-ranged query silently truncates to 1000,
  // causing ~43 teams to disappear from the count, grid, and CSV export.
  const { data: fetchedPicks = [] } = useQuery({
    enabled: !!activeId,
    queryKey: ["admin-picks-for-tournament", activeId],
    queryFn: async () => {
      const PAGE = 1000;
      let all: Array<{
        id: string;
        bucket: number;
        tweak_count: number;
        helper_used: boolean | null;
        tournament_id: string;
        golfers: { golfer_name: string } | null;
        teams: { id: string; nickname: string; owner_user_id: string };
      }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("picks")
          .select(
            `
            id,
            bucket,
            tweak_count,
            helper_used,
            tournament_id,
            golfers ( golfer_name ),
            teams!inner ( id, nickname, owner_user_id )
          `,
          )
          .eq("tournament_id", activeId!)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat((data ?? []) as unknown as typeof all);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  // JS pivot: one row per team
  type PivotRow = {
    teamId: string;
    teamName: string;
    ownerUserId: string;
    buckets: Record<number, string | undefined>;
    tweaks: number;
    helperUsed: boolean;
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
        helperUsed: false,
      };
      entry.buckets[p.bucket] = p.golfers?.golfer_name;
      entry.tweaks = Math.max(entry.tweaks, p.tweak_count ?? 0);
      // helper_used is per-pick, same as tweak_count — a team counts as
      // having used the helper if any one of its 7 picks did.
      entry.helperUsed = entry.helperUsed || !!p.helper_used;
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
    const list = usersWhoHaveNotEnteredYet
      .map((u) => u.email)
      .filter(Boolean)
      .join(", ");
    navigator.clipboard.writeText(list).then(
      () =>
        toast.success(
          `Copied ${usersWhoHaveNotEnteredYet.length} email${usersWhoHaveNotEnteredYet.length === 1 ? "" : "s"}`,
        ),
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
    const headers =
      "UUID,Full Name,Email,Team Nickname,Bucket 1,Bucket 2,Bucket 3,Bucket 4,Bucket 5,Bucket 6,Bucket 7,Tweaks,Helper Used";
    const lines = [headers];
    for (const r of pivotedRows) {
      const p = profileById.get(r.ownerUserId);
      const fullName = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.nickname || "";
      const row = [
        r.teamId,
        `"${fullName}"`,
        p?.email ?? "",
        `"${r.teamName ?? "—"}"`,
        ...[1, 2, 3, 4, 5, 6, 7].map((b) => `"${r.buckets[b] ?? "—"}"`),
        r.tweaks,
        r.helperUsed ? "Y" : "N",
      ];
      lines.push(row.join(","));
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
            <option key={t.id} value={t.id}>
              {t.name} ({t.start_date?.slice(0, 4) ?? ''})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Total Active Approved Users" value={activeApprovedUsers.length} />
        <Kpi label="Total Submissions Made" value={pivotedRows.length} />
        <Kpi
          label="Missing Entries"
          value={usersWhoHaveNotEnteredYet.length}
          highlight={usersWhoHaveNotEnteredYet.length > 0}
        />
      </div>

      {usersWhoHaveNotEnteredYet.length > 0 && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>
              {usersWhoHaveNotEnteredYet.length} approved user
              {usersWhoHaveNotEnteredYet.length === 1 ? "" : "s"} have not submitted
            </span>
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
                    const full =
                      [u.first_name, u.last_name].filter(Boolean).join(" ") || u.nickname;
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-1 pr-2">{full}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{u.nickname}</td>
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
                <TableHead>Name</TableHead>
                {[1, 2, 3, 4, 5, 6, 7].map((b) => (
                  <TableHead key={b}>Bucket {b}</TableHead>
                ))}
                <TableHead className="text-right">Tweaks</TableHead>
                <TableHead className="text-center">Helper Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivotedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">
                    No submissions yet for this tournament.
                  </TableCell>
                </TableRow>
              ) : (
                pivotedRows.map((r) => (
                  <TableRow key={r.teamId}>
                    <TableCell className="text-sm">{r.teamName ?? "—"}</TableCell>
                    {[1, 2, 3, 4, 5, 6, 7].map((b) => (
                      <TableCell key={b} className="text-xs">
                        {r.buckets[b] ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono">{r.tweaks}</TableCell>
                    <TableCell className="text-center text-xs font-semibold">
                      {r.helperUsed ? "Y" : "N"}
                    </TableCell>
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
        <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          {label}
        </div>
        <div className={`font-display text-4xl mt-1 ${highlight ? "text-destructive" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
