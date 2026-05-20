import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdminDesktopOnly } from "@/components/admin-desktop-only";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: () => <AdminDesktopOnly><AdminUsersPage /></AdminDesktopOnly>,
});

type Status = "pending" | "approved" | "rejected";
type Role = "admin" | "user";

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", user: "Player" };

interface ProfileRow {
  id: string;
  nickname: string;
  email: string | null;
  status: Status;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  referral_name: string | null;
  created_at: string;
}

function AdminUsersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: profiles = [], refetch } = useQuery({
    queryKey: ["admin-users-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, email, status, first_name, last_name, phone, referral_name, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProfileRow[];
    },
  });

  const { data: roles = [], refetch: refetchRoles } = useQuery({
    queryKey: ["admin-users-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data as Array<{ user_id: string; role: Role }>;
    },
  });

  const roleByUser = useMemo(() => {
    const m = new Map<string, Role>();
    for (const r of roles) {
      // admin wins if user has multiple
      if (r.role === "admin" || !m.has(r.user_id)) m.set(r.user_id, r.role);
    }
    return m;
  }, [roles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      const role = roleByUser.get(p.id) ?? "user";
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (!q) return true;
      const hay = [
        p.nickname, p.email, p.first_name, p.last_name, p.phone, p.referral_name,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, roleByUser, search, statusFilter, roleFilter]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  if (!isAdmin) {
    return (
      <div className="p-12">
        <p className="text-sm text-muted-foreground">Admin only.</p>
        <Link to="/home" className="text-xs uppercase underline">← Back</Link>
      </div>
    );
  }

  return (
    <div className="p-8 md:p-12 max-w-6xl">
      <Link to="/admin" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Admin</Link>
      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>User Management</p>
        <h1 className="font-display text-3xl uppercase mt-1">Users ({profiles.length})</h1>
      </header>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Search</label>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, team, phone…"
            className="w-full px-3 py-2 border border-input bg-white text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 border border-input bg-white text-sm">
            <option value="all">All</option>
            <option value="pending">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Role</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-2 border border-input bg-white text-sm">
            <option value="all">All</option>
            <option value="user">Player</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      <div className="bg-card border border-border overflow-hidden">
        <div className="grid grid-cols-[1.5fr_2fr_0.7fr_1fr_auto] gap-2 px-4 py-2 text-[10px] uppercase tracking-widest font-bold bg-muted/50 border-b border-border">
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Status</div>
          <div></div>
        </div>
        {filtered.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No users match.</p>}
        {filtered.map((p) => {
          const role = roleByUser.get(p.id) ?? "user";
          const full = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.nickname;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="w-full grid grid-cols-[1.5fr_2fr_0.7fr_1fr_auto] gap-2 px-4 py-3 text-left border-b border-border hover:bg-muted/40 text-sm items-center"
            >
              <div className="min-w-0">
                <div className="truncate">{full}</div>
                <div className="text-[10px] text-muted-foreground truncate">{p.nickname}</div>
              </div>
              <div className="truncate text-muted-foreground">{p.email ?? "—"}</div>
              <div className="text-xs">{ROLE_LABEL[role]}</div>
              <div>
                <StatusPill status={p.status} />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Edit →</div>
            </button>
          );
        })}
      </div>

      {selected && (
        <UserDrawer
          profile={selected}
          role={roleByUser.get(selected.id) ?? "user"}
          onClose={() => setSelectedId(null)}
          onSaved={() => { refetch(); refetchRoles(); qc.invalidateQueries({ queryKey: ["admin-profiles"] }); }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const color = status === "approved" ? "var(--forest-deep)" : status === "rejected" ? "var(--alert)" : "var(--gold)";
  return (
    <span className="inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-1 text-white"
      style={{ backgroundColor: color }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function UserDrawer({ profile, role, onClose, onSaved }: {
  profile: ProfileRow;
  role: Role;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    phone: profile.phone ?? "",
    referral_name: profile.referral_name ?? "",
    nickname: profile.nickname ?? "",
    status: profile.status as Status,
    role: role as Role,
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function save() {
    setSaving(true);
    const nickname = draft.nickname.trim() || [draft.first_name, draft.last_name].filter(Boolean).join(" ") || profile.nickname;
    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        first_name: draft.first_name || null,
        last_name: draft.last_name || null,
        phone: draft.phone || null,
        referral_name: draft.referral_name || null,
        status: draft.status,
        nickname,
      })
      .eq("id", profile.id);
    if (pErr) { toast.error(pErr.message); setSaving(false); return; }

    // Sync role: ensure only the selected role exists for this user
    if (draft.role !== role) {
      if (draft.role === "admin") {
        const { error } = await supabase.from("user_roles").upsert(
          { user_id: profile.id, role: "admin" },
          { onConflict: "user_id,role" },
        );
        if (error) { toast.error(`Role: ${error.message}`); setSaving(false); return; }
      } else {
        const { error } = await supabase.from("user_roles").delete()
          .eq("user_id", profile.id).eq("role", "admin");
        if (error) { toast.error(`Role: ${error.message}`); setSaving(false); return; }
      }
    }

    toast.success("User updated");
    setSaving(false);
    onSaved();
    onClose();
  }

  async function resetPassword() {
    if (!profile.email) { toast.error("No email on file"); return; }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    if (error) toast.error(error.message);
    else toast.success(`Password reset email sent to ${profile.email}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div className="w-full max-w-md bg-background border-l border-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--gold)" }}>Edit User</p>
            <h2 className="font-display text-xl uppercase mt-1">{profile.nickname}</h2>
          </div>
          <button onClick={onClose} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">Close ✕</button>
        </div>

        <div className="p-6 space-y-4">
          <Field label="User ID">
            <input value={profile.id} disabled
              className="w-full px-3 py-2 border border-input bg-muted text-xs font-mono text-muted-foreground" />
          </Field>
          <Field label="Email (login)">
            <input value={profile.email ?? ""} disabled
              className="w-full px-3 py-2 border border-input bg-muted text-sm text-muted-foreground" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
                className="w-full px-3 py-2 border border-input bg-white text-sm" />
            </Field>
            <Field label="Last name">
              <input value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
                className="w-full px-3 py-2 border border-input bg-white text-sm" />
            </Field>
          </div>
          <Field label="Phone">
            <input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="w-full px-3 py-2 border border-input bg-white text-sm" />
          </Field>
          <Field label="Referral name">
            <input value={draft.referral_name} onChange={(e) => setDraft({ ...draft, referral_name: e.target.value })}
              className="w-full px-3 py-2 border border-input bg-white text-sm" />
          </Field>
          <Field label="Team nickname">
            <input value={draft.team_nickname} onChange={(e) => setDraft({ ...draft, team_nickname: e.target.value })}
              className="w-full px-3 py-2 border border-input bg-white text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
                className="w-full px-3 py-2 border border-input bg-white text-sm">
                <option value="user">Player</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
                className="w-full px-3 py-2 border border-input bg-white text-sm">
                <option value="pending">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving}
              className="flex-1 py-3 font-display text-xs uppercase tracking-widest text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--forest-deep)" }}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button onClick={onClose}
              className="px-4 py-3 font-display text-xs uppercase tracking-widest border border-border hover:bg-muted">
              Cancel
            </button>
          </div>

          <div className="pt-4 mt-4 border-t border-border">
            <p className="text-[10px] uppercase tracking-widest font-bold mb-2">Account actions</p>
            <button onClick={resetPassword} disabled={resetting || !profile.email}
              className="w-full py-2 text-xs font-bold uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50">
              {resetting ? "Sending…" : "Send password reset email"}
            </button>
            {draft.status !== "approved" && (
              <button
                onClick={async () => {
                  setDraft({ ...draft, status: "approved" });
                  const { error } = await supabase.from("profiles").update({ status: "approved" }).eq("id", profile.id);
                  if (error) toast.error(error.message);
                  else { toast.success("User approved"); onSaved(); }
                }}
                className="mt-2 w-full py-2 text-xs font-bold uppercase tracking-widest text-white"
                style={{ backgroundColor: "var(--forest-deep)" }}>
                Approve immediately
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">{label}</label>
      {children}
    </div>
  );
}
