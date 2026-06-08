import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  updateUserEmail,
  listUsersForAdmin,
  sendWelcomeEmails,
  type DirectoryRow,
} from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Settings,
  Plus,
  Trash2,
  EyeOff,
  ShieldCheck,
  Search,
  Star,
  Trophy,
  History,
  Download,
  Pencil,
  Mail,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useImpersonation } from "@/context/impersonation-context";

interface TeamRow {
  id: string;
  owner_user_id: string;
  nickname: string;
  is_primary: boolean;
  created_at: string;
}

const PAGE_SIZE = 25;
const ACTIVE_DAYS = 14;

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected", "suspended"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

const ENGAGEMENT_OPTIONS = ["all", "active", "dormant", "never"] as const;
type EngagementFilter = (typeof ENGAGEMENT_OPTIONS)[number];
type Engagement = "active" | "dormant" | "never";

type SortKey = "name" | "email" | "status" | "engagement" | "lastSeen" | "joined";

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "suspended" || status === "rejected") return "destructive";
  return "secondary"; // pending
}

function engagementOf(lastSignInAt: string | null): Engagement {
  if (!lastSignInAt) return "never";
  const days = (Date.now() - new Date(lastSignInAt).getTime()) / 86_400_000;
  return days <= ACTIVE_DAYS ? "active" : "dormant";
}

function lastSeenLabel(s: string | null): string {
  if (!s) return "—";
  const days = Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB");
}

function fullNameOf(u: { first_name: string | null; last_name: string | null; nickname: string }) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.nickname;
}

function EngagementDot({ engagement }: { engagement: Engagement }) {
  const map: Record<Engagement, { color: string; label: string }> = {
    active: { color: "var(--color-text-success, #16a34a)", label: "Active" },
    dormant: { color: "var(--color-text-warning, #d97706)", label: "Dormant" },
    never: { color: "var(--color-text-info, #2563eb)", label: "Never logged in" },
  };
  const e = map[engagement];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        className="inline-block size-2 rounded-full shrink-0"
        style={{ background: e.color }}
        aria-hidden
      />
      {e.label}
    </span>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        {active ? (
          sortDir === 1 ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        ) : (
          <ChevronsUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export function UsersDirectoryTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("joined");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [sending, setSending] = useState(false);
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();
  const listFn = useServerFn(listUsersForAdmin);
  const sendWelcomeFn = useServerFn(sendWelcomeEmails);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users-directory"],
    queryFn: async () => (await listFn({ data: {} })) as DirectoryRow[],
  });

  const selected = useMemo(
    () => (selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null),
    [selectedId, users],
  );

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, engagementFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = { total: users.length, approved: 0, pending: 0, active: 0, never: 0 };
    for (const u of users) {
      if (u.status === "approved") c.approved++;
      else if (u.status === "pending") c.pending++;
      const eng = engagementOf(u.last_sign_in_at);
      if (eng === "active") c.active++;
      if (eng === "never" && u.status === "approved") c.never++;
    }
    return c;
  }, [users]);

  // Approved users who have never logged in — the migration backlog.
  const neverLoggedIn = useMemo(
    () => users.filter((u) => u.status === "approved" && !u.last_sign_in_at),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (engagementFilter !== "all" && engagementOf(u.last_sign_in_at) !== engagementFilter)
        return false;
      if (!q) return true;
      const hay = [u.first_name, u.last_name, u.nickname, u.primary_team_nickname, u.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, search, statusFilter, engagementFilter]);

  const sorted = useMemo(() => {
    const statusRank: Record<string, number> = { approved: 0, pending: 1, suspended: 2, rejected: 3 };
    const engRank: Record<Engagement, number> = { active: 0, dormant: 1, never: 2 };
    const rows = [...filtered];
    rows.sort((a, b) => {
      let x = 0;
      switch (sortKey) {
        case "name":
          return fullNameOf(a).localeCompare(fullNameOf(b)) * sortDir;
        case "email":
          return (a.email ?? "").localeCompare(b.email ?? "") * sortDir;
        case "status":
          x = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
          break;
        case "engagement":
          x = engRank[engagementOf(a.last_sign_in_at)] - engRank[engagementOf(b.last_sign_in_at)];
          break;
        case "lastSeen": {
          const av = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : -Infinity;
          const bv = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : -Infinity;
          x = av - bv;
          break;
        }
        case "joined":
          x = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return x * sortDir;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "email" ? 1 : -1);
    }
  }

  async function sendWelcome(ids: string[]) {
    if (ids.length === 0) {
      toast.message("No users to send to");
      return;
    }
    if (
      !window.confirm(
        `Send a set-password welcome email to ${ids.length} user${ids.length === 1 ? "" : "s"}? ` +
          `They'll be prompted to set a password on first login.`,
      )
    )
      return;
    setSending(true);
    try {
      const res = await sendWelcomeFn({
        data: { userIds: ids, redirectTo: `${window.location.origin}/welcome` },
      });
      if (res.sent > 0)
        toast.success(`Sent ${res.sent} welcome email${res.sent === 1 ? "" : "s"}`);
      if (res.failed > 0) toast.error(`${res.failed} failed to send`);
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span>User Directory &amp; Management</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => exportAllUsers(users)}>
              <Download className="size-3.5" /> Export Users
            </Button>
            <span className="text-xs font-mono text-muted-foreground">{counts.total} users</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <SummaryPill label="Total" value={counts.total} />
          <SummaryPill label="Approved" value={counts.approved} />
          <SummaryPill label="Active (14d)" value={counts.active} tone="success" />
          <SummaryPill label="Pending" value={counts.pending} />
          <SummaryPill label="Never logged in" value={counts.never} tone="info" />
        </div>

        {/* Migration backlog banner */}
        {neverLoggedIn.length > 0 && (
          <div className="mb-4 rounded-lg border bg-card/50 p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm">
              <span className="font-medium">{neverLoggedIn.length}</span> approved user
              {neverLoggedIn.length === 1 ? " has" : "s have"} never logged in.
              <span className="text-muted-foreground"> Send the set-password welcome to get them onto the platform.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={() => sendWelcome(neverLoggedIn.map((u) => u.id))}
            >
              <Mail className="size-3.5" /> Send welcome ({neverLoggedIn.length})
            </Button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or nickname…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={engagementFilter}
            onValueChange={(v) => setEngagementFilter(v as EngagementFilter)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All engagement</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="dormant">Dormant</SelectItem>
              <SelectItem value="never">Never logged in</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="User" k="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHead label="Email" k="email" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHead label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHead label="Engagement" k="engagement" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHead label="Last seen" k="lastSeen" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHead label="Joined" k="joined" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        No users match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pageRows.map((u) => {
                      const full = fullNameOf(u);
                      const eng = engagementOf(u.last_sign_in_at);
                      return (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(u.id)}
                        >
                          <TableCell>
                            <div className="font-medium">{full}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {u.primary_team_nickname ?? u.nickname}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                            {u.email ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(u.status)} className="capitalize">
                              {u.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <EngagementDot engagement={eng} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {lastSeenLabel(u.last_sign_in_at)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {fmtDate(u.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              {eng === "never" && u.email && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={sending}
                                  title="Send set-password welcome email"
                                  onClick={() => sendWelcome([u.id])}
                                >
                                  <Mail className="size-3.5" />
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={() => setSelectedId(u.id)}>
                                <Settings className="size-3.5" /> Manage
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  startImpersonation(u.id);
                                  toast.success(`Simulation initialized: Acting as ${full}`);
                                  navigate({ to: "/home" });
                                }}
                              >
                                <EyeOff className="size-3.5" /> Simulate
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                {sorted.length === 0
                  ? "0"
                  : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, sorted.length)}`}{" "}
                of {sorted.length}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="px-2 py-1.5 text-xs">
                  Page {page + 1} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <UserDrawer
        user={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
        primaryTeamNickname={selected?.primary_team_nickname ?? null}
      />
    </Card>
  );
}

function exportAllUsers(users: DirectoryRow[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers =
    "First Name,Last Name,Email,Phone,Primary Team Nickname,Referral,Status,Engagement,Last Seen,Joined";
  const lines = [headers];
  for (const u of users) {
    const row = [
      esc(u.first_name ?? ""),
      esc(u.last_name ?? ""),
      esc(u.email ?? ""),
      esc(u.phone ?? ""),
      esc(u.primary_team_nickname ?? u.nickname),
      esc(u.referral_name ?? ""),
      esc(u.status),
      esc(engagementOf(u.last_sign_in_at)),
      esc(u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("en-GB") : ""),
      esc(fmtDate(u.created_at)),
    ];
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `major7s-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "info";
}) {
  const toneStyle =
    tone === "success"
      ? { color: "var(--color-text-success, #16a34a)" }
      : tone === "info"
        ? { color: "var(--color-text-info, #2563eb)" }
        : undefined;
  return (
    <div className="rounded-md border bg-card/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold" style={toneStyle}>
        {value}
      </div>
    </div>
  );
}

function UserDrawer({
  user,
  open,
  onOpenChange,
  primaryTeamNickname,
}: {
  user: DirectoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryTeamNickname: string | null;
}) {
  const qc = useQueryClient();
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [editingProfile, setEditingProfile] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"admin" | "user">("user");
  const [status, setStatus] = useState<string>("pending");
  const [emailDraft, setEmailDraft] = useState<string>("");
  const updateUserEmailFn = useServerFn(updateUserEmail);

  const { data: currentRole = "user", refetch: refetchRole } = useQuery({
    queryKey: ["admin-user-role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw error;
      return data ? ("admin" as const) : ("user" as const);
    },
  });

  const {
    data: teams = [],
    isLoading: teamsLoading,
    refetch: refetchTeams,
  } = useQuery({
    queryKey: ["admin-user-teams", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, owner_user_id, nickname, is_primary, created_at")
        .eq("owner_user_id", user!.id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamRow[];
    },
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ["admin-user-entries", user?.id, teams.map((t) => t.id).join(",")],
    enabled: !!user?.id && teams.length > 0,
    queryFn: async () => {
      const teamIds = teams.map((t) => t.id);
      const { data, error } = await supabase
        .from("picks")
        .select("team_id, bucket, tournaments(id, name, status, start_date)")
        .in("team_id", teamIds);
      if (error) throw error;
      const byTournament = new Map<
        string,
        { name: string; status: string; startDate: string | null; picks: number }
      >();
      for (const row of (data ?? []) as any[]) {
        const t = row.tournaments;
        if (!t) continue;
        const e = byTournament.get(t.id) ?? {
          name: t.name,
          status: t.status,
          startDate: t.start_date ?? null,
          picks: 0,
        };
        e.picks += 1;
        byTournament.set(t.id, e);
      }
      return Array.from(byTournament.values());
    },
  });

  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ["admin-user-activity", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_audit")
        .select("action, detail, created_at")
        .eq("target_user", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Array<{ action: string; detail: any; created_at: string }>;
    },
  });

  useEffect(() => {
    setEdits({});
    setProfileEdits({});
    setEditingProfile(false);
    setNewTeamName("");
    setSelectedRole(currentRole);
  }, [user?.id, currentRole]);

  useEffect(() => {
    if (user) {
      setStatus(user.status);
      setEmailDraft(user.email ?? "");
    }
  }, [user]);

  async function handleUpdateEmail() {
    if (!user) return;
    const next = emailDraft.trim().toLowerCase();
    const current = (user.email ?? "").toLowerCase();
    if (!next || next === current) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (
      !window.confirm(
        `Change login email from ${user.email ?? "(none)"} to ${next}? The user will sign in with the new email.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await updateUserEmailFn({ data: { userId: user.id, newEmail: next } });
      toast.success("Email updated");
      qc.invalidateQueries({ queryKey: ["admin-users-directory"] });
      qc.invalidateQueries({ queryKey: ["admin-user-activity", user.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update email");
    } finally {
      setBusy(false);
    }
  }

  const fullName = useMemo(() => {
    if (!user) return "";
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.nickname;
  }, [user]);

  async function handleStatusChange(next: string) {
    if (!user || next === status) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ status: next }).eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Status set to ${next}`);
    setStatus(next);
    qc.invalidateQueries({ queryKey: ["admin-users-directory"] });
    qc.invalidateQueries({ queryKey: ["admin-pending-profiles"] });
    qc.invalidateQueries({ queryKey: ["admin-pending-count"] });
  }

  async function handleDelete(team: TeamRow) {
    if (team.is_primary) return;
    if (!window.confirm(`Delete team "${team.nickname}"? This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Team "${team.nickname}" deleted`);
    setEdits((e) => {
      const next = { ...e };
      delete next[team.id];
      return next;
    });
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleAdd() {
    if (!user) return;
    const name = newTeamName.trim();
    if (!name) {
      toast.error("Enter a team nickname");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("teams")
      .insert({ owner_user_id: user.id, nickname: name, is_primary: false });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Team "${name}" added`);
    setNewTeamName("");
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleMakePrimary(team: TeamRow) {
    if (team.is_primary) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_primary_team", { _team_id: team.id });
    setBusy(false);
    if (error) {
      toast.error(`Make primary: ${error.message}`);
      return;
    }
    toast.success(`"${team.nickname}" is now the primary team`);
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["primary-team"] });
    qc.invalidateQueries({ queryKey: ["admin-users-directory"] });
  }

  async function handleRoleChange(newRole: "admin" | "user") {
    if (!user || newRole === currentRole) return;
    setBusy(true);
    if (newRole === "admin") {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });
      if (error) {
        toast.error(`Role: ${error.message}`);
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", user.id)
        .eq("role", "admin");
      if (error) {
        toast.error(`Role: ${error.message}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    toast.success(`Role updated to ${newRole === "admin" ? "Admin" : "Player"}`);
    setSelectedRole(newRole);
    refetchRole();
    qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
  }

  async function handleSaveProfileEdits() {
    if (!user) return;
    const updates: {
      first_name?: string | null;
      last_name?: string | null;
      phone?: string | null;
      referral_name?: string | null;
    } = {};
    const fields = ["first_name", "last_name", "phone", "referral_name"] as const;
    for (const f of fields) {
      if (f in profileEdits) {
        const v = profileEdits[f].trim();
        updates[f] = v || null;
      }
    }
    if (Object.keys(updates).length === 0) {
      toast.message("No profile changes to save");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(`Profile update failed: ${error.message}`);
      return;
    }
    toast.success("Profile details updated");
    setProfileEdits({});
    setEditingProfile(false);
    qc.invalidateQueries({ queryKey: ["admin-users-directory"] });
  }

  async function handleSaveNicknames() {
    if (!user) return;
    const changed = teams
      .map((t) => ({ team: t, next: (edits[t.id] ?? t.nickname).trim() }))
      .filter(({ team, next }) => next.length > 0 && next !== team.nickname);
    if (changed.length === 0) {
      toast.message("No team nickname changes to save");
      return;
    }
    setBusy(true);
    let failed = 0;
    for (const { team, next } of changed) {
      const { error } = await supabase.from("teams").update({ nickname: next }).eq("id", team.id);
      if (error) failed++;
    }
    setBusy(false);
    if (failed > 0) toast.error(`${failed} team(s) failed to update`);
    else toast.success("Team nicknames updated");
    setEdits({});
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["admin-users-directory"] });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {user && (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{fullName}</SheetTitle>
                  <p className="text-sm text-muted-foreground font-mono truncate">
                    {user.email ?? "—"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    startImpersonation(user.id);
                    toast.success(`Simulation initialized: Acting as ${fullName}`);
                    navigate({ to: "/home" });
                  }}
                >
                  <EyeOff className="size-3.5" /> Simulate
                </Button>
              </div>
            </SheetHeader>

            {/* Role + Status */}
            <section className="mt-4 rounded-lg border bg-card/50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
                Account Configuration
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1 h-4">
                    <ShieldCheck className="size-3.5" /> Role
                  </Label>
                  <Select
                    value={selectedRole}
                    onValueChange={(v) => handleRoleChange(v as "admin" | "user")}
                  >
                    <SelectTrigger className="h-9 mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Player</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground h-4">
                    Status
                  </Label>
                  <Select value={status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-9 mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Engagement / onboarding readout */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Engagement</span>
                <EngagementDot engagement={engagementOf(user.last_sign_in_at)} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Last seen</span>
                <span>
                  {user.last_sign_in_at
                    ? new Date(user.last_sign_in_at).toLocaleString("en-GB")
                    : "Never"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Password set</span>
                <span>{user.onboarded_at ? fmtDate(user.onboarded_at) : "Not yet"}</span>
              </div>
            </section>

            {/* User Details (view / edit) */}
            <section className="mt-4 rounded-lg border bg-card/50 p-4">
              <header className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">User Details</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (editingProfile) {
                      setProfileEdits({});
                      setEditingProfile(false);
                    } else {
                      setEditingProfile(true);
                    }
                  }}
                >
                  <Pencil className="size-3.5" /> {editingProfile ? "Cancel" : "Edit"}
                </Button>
              </header>

              {editingProfile ? (
                <div className="space-y-2">
                  {(
                    [
                      ["first_name", "First Name"],
                      ["last_name", "Last Name"],
                      ["phone", "Phone"],
                      ["referral_name", "Referral"],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <Input
                        className="h-9 mt-0.5"
                        value={profileEdits[field] ?? user[field] ?? ""}
                        onChange={(e) => setProfileEdits((s) => ({ ...s, [field]: e.target.value }))}
                        placeholder={label}
                      />
                    </div>
                  ))}
                  <div>
                    <Label className="text-xs text-muted-foreground">Email (Login)</Label>
                    <div className="flex gap-2 mt-0.5">
                      <Input
                        className="h-9 flex-1"
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        placeholder="user@example.com"
                        type="email"
                        autoComplete="off"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          busy ||
                          !emailDraft.trim() ||
                          emailDraft.trim().toLowerCase() === (user.email ?? "").toLowerCase()
                        }
                        onClick={handleUpdateEmail}
                      >
                        Update
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Updates the user's login email and profile. Password is unchanged.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <DetailRow label="First Name" value={user.first_name} />
                  <DetailRow label="Last Name" value={user.last_name} />
                  <DetailRow label="Email" value={user.email} />
                  <DetailRow label="Phone" value={user.phone} />
                  <DetailRow label="Referral" value={user.referral_name} />
                  <DetailRow
                    label="Primary Team Nickname"
                    value={primaryTeamNickname ?? user.nickname}
                  />
                </div>
              )}
            </section>

            {/* Teams */}
            <section className="mt-4 rounded-lg border bg-card/50 p-4">
              <header className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider">Registered Teams</h3>
                <span className="text-xs font-mono text-muted-foreground">{teams.length} total</span>
              </header>

              {teamsLoading ? (
                <p className="text-sm text-muted-foreground py-2">Loading teams…</p>
              ) : teams.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No teams registered.</p>
              ) : (
                <div className="space-y-2">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className="flex items-center gap-2 rounded-md border bg-background p-2"
                    >
                      <Input
                        value={edits[team.id] ?? team.nickname}
                        onChange={(e) => setEdits((s) => ({ ...s, [team.id]: e.target.value }))}
                        className="h-9 flex-1"
                        placeholder="Team nickname"
                      />
                      {team.is_primary ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                          Primary
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleMakePrimary(team)}
                          title="Make primary"
                        >
                          <Star className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={team.is_primary || busy}
                        onClick={() => handleDelete(team)}
                        title={team.is_primary ? "Cannot delete primary team" : "Delete team"}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 pt-3 border-t flex gap-2">
                <Input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="New team nickname"
                  className="h-9 flex-1"
                />
                <Button size="sm" onClick={handleAdd} disabled={busy || !newTeamName.trim()}>
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
              {Object.keys(edits).length > 0 && (
                <Button size="sm" className="mt-2 w-full" onClick={handleSaveNicknames} disabled={busy}>
                  Save nickname changes
                </Button>
              )}
              {Object.keys(profileEdits).length > 0 && (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={handleSaveProfileEdits}
                  disabled={busy}
                >
                  Save Profile Changes
                </Button>
              )}
            </section>

            {/* Competition entries */}
            <section className="mt-4 rounded-lg border bg-card/50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Trophy className="size-3.5" /> Competition Entries
              </h3>
              {entriesLoading ? (
                <p className="text-sm text-muted-foreground py-2">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No tournament entries.</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {entries.map((e, i) => {
                    const year = e.startDate ? new Date(e.startDate).getFullYear() : null;
                    return (
                      <div key={i} className="flex items-center justify-between">
                        <span>
                          {e.name}
                          {year !== null && ` (${year})`}
                        </span>
                        <span
                          className={
                            e.picks >= 7 ? "text-emerald-600 text-xs" : "text-amber-600 text-xs"
                          }
                        >
                          {e.picks >= 7 ? "Submitted" : `${e.picks}/7 picks`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Account activity (admin actions) */}
            <section className="mt-4 rounded-lg border bg-card/50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <History className="size-3.5" /> Account Activity
              </h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                Admin actions taken on this account.
              </p>
              {activityLoading ? (
                <p className="text-sm text-muted-foreground py-2">Loading…</p>
              ) : activity.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No recorded activity.</p>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {activity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{a.action}</span>
                      <span className="text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || "—"}</span>
    </div>
  );
}
