import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Settings, Plus, Trash2, EyeOff } from "lucide-react";
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

export function UsersDirectoryTab() {
  const [selected, setSelected] = useState<ProfileRow | null>(null);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>User Directory &amp; Management</span>
          <span className="text-xs font-mono text-muted-foreground">{users.length} users</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : (
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
                {users.map((u) => {
                  const full = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.nickname;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{full}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                      <TableCell className="text-sm">{u.nickname}</TableCell>
                      <TableCell>
                        <Badge variant={u.status === "approved" ? "default" : "secondary"} className="capitalize">
                          {u.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                            <Settings className="size-3.5" /> ⚙️ Manage Account
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
                            <EyeOff className="size-3.5" /> 🕵️ Simulate User
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

      <ManageAccountDialog
        user={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Card>
  );
}

function ManageAccountDialog({
  user,
  open,
  onOpenChange,
}: {
  user: ProfileRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newTeamName, setNewTeamName] = useState("");
  const [busy, setBusy] = useState(false);

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
  }, [user?.id]);

  const fullName = useMemo(() => {
    if (!user) return "";
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.nickname;
  }, [user]);

  async function handleDelete(team: TeamRow) {
    if (team.is_primary) return;
    if (!window.confirm(`Delete team "${team.nickname}"? This cannot be undone.`)) return;
    if (!window.confirm(`Are you absolutely sure? This will permanently remove team "${team.nickname}".`)) return;
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
    refetch();
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
    refetch();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleSave() {
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

    if (failed > 0) {
      toast.error(`${failed} team(s) failed to update`);
    } else {
      toast.success("User team configuration updated successfully");
    }
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
                <div
                  key={team.id}
                  className="flex items-center gap-3 rounded-md border bg-background p-2.5"
                >
                  <Input
                    value={edits[team.id] ?? team.nickname}
                    onChange={(e) => setEdits((s) => ({ ...s, [team.id]: e.target.value }))}
                    className="h-9 flex-1"
                    placeholder="Team nickname"
                  />
                  {team.is_primary ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Primary</Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-slate-500 text-white hover:bg-slate-500">
                      Additional
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={team.is_primary || busy}
                    onClick={() => handleDelete(team)}
                    title={team.is_primary ? "Cannot delete primary team" : "Delete team"}
                  >
                    <Trash2 className="size-3.5" /> 🗑️
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
                <Plus className="size-3.5" /> ＋ Add Team
              </Button>
            </div>
          </div>
        </section>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            Save Configuration Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
