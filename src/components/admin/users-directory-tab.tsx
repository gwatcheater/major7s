import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Settings, Plus, Trash2, EyeOff, ShieldCheck, Search, Star } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useImpersonation } from "@/context/impersonation-context";

interface ProfileRow {
  id: string;
  nickname: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
}

interface TeamRow {
  id: string;
  owner_user_id: string;
  nickname: string;
  is_primary: boolean;
  created_at: string;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected", "suspended"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "suspended" || status === "rejected") return "destructive";
  return "secondary"; // pending
}

export function UsersDirectoryTab() {
  const [selected, setSelected] = useState<ProfileRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, email, first_name, last_name, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  // Reset to first page whenever the filters change.
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const counts = useMemo(() => {
    const c = { total: users.length, pending: 0, approved: 0, suspended: 0, rejected: 0 };
    for (const u of users) {
      if (u.status === "pending") c.pending++;
      else if (u.status === "approved") c.approved++;
      else if (u.status === "suspended") c.suspended++;
      else if (u.status === "rejected") c.rejected++;
    }
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [u.first_name, u.last_name, u.nickname, u.email]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [users, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>User Directory &amp; Management</span>
          <span className="text-xs font-mono text-muted-foreground">{counts.total} users</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <SummaryPill label="Total" value={counts.total} />
          <SummaryPill label="Pending" value={counts.pending} />
          <SummaryPill label="Approved" value={counts.approved} />
          <SummaryPill label="Suspended" value={counts.suspended} />
          <SummaryPill label="Rejected" value={counts.rejected} />
        </div>

        {/* Search + status filter */}
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
            <SelectTrigger className="w-full sm:w-44">
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
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Nickname</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                        No users match.
                      </TableCell>
                    </TableRow>
                  ) : pageRows.map((u) => {
                    const full = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.nickname;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{full}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                        <TableCell className="text-sm">{u.nickname}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(u.status)} className="capitalize">
                            {u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                              <Settings className="size-3.5" /> Manage Account
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
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                {filtered.length === 0 ? "0" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)}`} of {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="px-2 py-1.5 text-xs">Page {page + 1} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <ManageAccountDialog
        user={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Card>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function ManageAccountDialog({
  user, open, onOpenChange,
}: {
  user: ProfileRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { assertWritable } = useImpersonation();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newTeamName, setNewTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"admin" | "user">("user");

  const { data: currentRole = "user", refetch: refetchRole } = useQuery({
    queryKey: ["admin-user-role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", user!.id).eq("role", "admin").maybeSingle();
      if (error) throw error;
      return data ? ("admin" as const) : ("user" as const);
    },
  });

  const { data: teams = [], isLoading, refetch } = useQuery({
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

  useEffect(() => {
    setEdits({});
    setNewTeamName("");
    setSelectedRole(currentRole);
  }, [user?.id, currentRole]);

  const fullName = useMemo(() => {
    if (!user) return "";
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.nickname;
  }, [user]);

  async function handleDelete(team: TeamRow) {
    if (team.is_primary) return;
    if (!window.confirm(`Delete team "${team.nickname}"? This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Team "${team.nickname}" deleted`);
    setEdits((e) => { const next = { ...e }; delete next[team.id]; return next; });
    refetch();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleAdd() {
    if (!user) return;
    const name = newTeamName.trim();
    if (!name) { toast.error("Enter a team nickname"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("teams").insert({ owner_user_id: user.id, nickname: name, is_primary: false });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Team "${name}" added`);
    setNewTeamName("");
    refetch();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleMakePrimary(team: TeamRow) {
    if (team.is_primary) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_primary_team", { _team_id: team.id });
    setBusy(false);
    if (error) { toast.error(`Make primary: ${error.message}`); return; }
    toast.success(`"${team.nickname}" is now the primary team`);
    refetch();
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["primary-team"] });
  }

  async function handleRoleChange(newRole: "admin" | "user") {
    if (!user || newRole === currentRole) return;
    setBusy(true);
    if (newRole === "admin") {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });
      if (error) { toast.error(`Role: ${error.message}`); setBusy(false); return; }
    } else {
      const { error } = await supabase
        .from("user_roles").delete().eq("user_id", user.id).eq("role", "admin");
      if (error) { toast.error(`Role: ${error.message}`); setBusy(false); return; }
    }
    setBusy(false);
    toast.success(`Role updated to ${newRole === "admin" ? "Admin" : "Player"}`);
    setSelectedRole(newRole);
    refetchRole();
    qc.invalidateQueries({ queryKey: ["admin-users-roles"] });
  }

  async function handleSave() {
    if (!user) return;
    const changed = teams
      .map((t) => ({ team: t, next: (edits[t.id] ?? t.nickname).trim() }))
      .filter(({ team, next }) => next.length > 0 && next !== team.nickname);

    if (changed.length === 0) { toast.message("No team nickname changes to save"); return; }

    setBusy(true);
    let failed = 0;
    for (const { team, next } of changed) {
      const { error } = await supabase.from("teams").update({ nickname: next }).eq("id", team.id);
      if (error) failed++;
    }
    setBusy(false);

    if (failed > 0) toast.error(`${failed} team(s) failed to update`);
    else toast.success("User team configuration updated successfully");
    setEdits({});
    refetch();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account Configuration Panel</DialogTitle>
          {user && (
            <p className="text-sm text-muted-foreground">
              {fullName} <span className="font-mono">· {user.email ?? "—"}</span>
            </p>
          )}
        </DialogHeader>

        <section className="mt-4 rounded-lg border bg-card/50 p-4">
          <header className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider">User Role</h3>
          </header>
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <div className="flex-1">
              <Label htmlFor="role-select" className="text-xs uppercase tracking-wider text-muted-foreground">
                Role
              </Label>
              <Select value={selectedRole} onValueChange={(v) => handleRoleChange(v as "admin" | "user")}>
                <SelectTrigger id="role-select" className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Player</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-lg border bg-card/50 p-4">
          <header className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Registered Team Entries</h3>
            <span className="text-xs font-mono text-muted-foreground">{teams.length} total</span>
          </header>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading teams…</p>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No teams registered.</p>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => (
                <div key={team.id} className="flex items-center gap-3 rounded-md border bg-background p-2.5">
                  <Input
                    value={edits[team.id] ?? team.nickname}
                    onChange={(e) => setEdits((s) => ({ ...s, [team.id]: e.target.value }))}
                    className="h-9 flex-1"
                    placeholder="Team nickname"
                  />
                  {team.is_primary ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Primary</Badge>
                  ) : (
                    <Button
                      size="sm" variant="outline"
                      disabled={busy}
                      onClick={() => handleMakePrimary(team)}
                      title="Make this the primary team"
                    >
                      <Star className="size-3.5" /> Make Primary
                    </Button>
                  )}
                  <Button
                    size="sm" variant="destructive"
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

          <div className="mt-4 pt-4 border-t">
            <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
              Register New Team Entry
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="New team nickname"
                className="h-9 flex-1"
              />
              <Button size="sm" onClick={handleAdd} disabled={busy || !newTeamName.trim()}>
                <Plus className="size-3.5" /> Add Team
              </Button>
            </div>
          </div>
        </section>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSave} disabled={busy}>Save Configuration Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
