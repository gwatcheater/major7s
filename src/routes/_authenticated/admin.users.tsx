import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdminDesktopOnly } from "@/components/admin-desktop-only";
import { Check, X, Users, Clock, ShieldCheck, UserX, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: () => <AdminDesktopOnly><AdminUsersPage /></AdminDesktopOnly>,
});

type Status = "pending" | "approved" | "rejected";
type Role = "admin" | "user";
type TabKey = "all" | "pending" | "players" | "admins" | "suspended";

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Suspended",
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
  const [tab, setTab] = useState<TabKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      if (r.role === "admin" || !m.has(r.user_id)) m.set(r.user_id, r.role);
    }
    return m;
  }, [roles]);

  const counts = useMemo(() => {
    let pending = 0, approved = 0, suspended = 0, admins = 0, players = 0;
    for (const p of profiles) {
      if (p.status === "pending") pending++;
      else if (p.status === "approved") approved++;
      else if (p.status === "rejected") suspended++;
      const role = roleByUser.get(p.id) ?? "user";
      if (role === "admin") admins++; else players++;
    }
    return { total: profiles.length, pending, approved, suspended, admins, players };
  }, [profiles, roleByUser]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      const role = roleByUser.get(p.id) ?? "user";
      if (tab === "pending" && p.status !== "pending") return false;
      if (tab === "suspended" && p.status !== "rejected") return false;
      if (tab === "admins" && role !== "admin") return false;
      if (tab === "players" && role !== "user") return false;
      if (!q) return true;
      const hay = [p.nickname, p.email, p.first_name, p.last_name, p.phone, p.referral_name]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, roleByUser, search, tab]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  async function quickUpdateStatus(id: string, status: Status) {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "approved" ? "User approved" : status === "rejected" ? "User rejected" : "Updated");
    refetch();
  }

  if (!isAdmin) {
    return (
      <div className="p-12">
        <p className="text-sm text-muted-foreground">Admin only.</p>
        <Link to="/home" className="text-xs uppercase underline">← Back</Link>
      </div>
    );
  }

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "all", label: "All Users", count: counts.total },
    { key: "pending", label: "Pending Approval", count: counts.pending },
    { key: "players", label: "Players", count: counts.players },
    { key: "admins", label: "Admins", count: counts.admins },
    { key: "suspended", label: "Suspended", count: counts.suspended },
  ];

  return (
    <div className="p-8 md:p-12 max-w-6xl">
      <Link to="/admin" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Admin</Link>
      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>User Management</p>
        <h1 className="font-display text-3xl uppercase mt-1">Users</h1>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard icon={<Users className="size-4" />} label="Total Users" value={counts.total} />
        <SummaryCard icon={<Clock className="size-4" />} label="Pending" value={counts.pending} accent="var(--gold)" />
        <SummaryCard icon={<ShieldCheck className="size-4" />} label="Admins" value={counts.admins} accent="var(--forest-deep)" />
        <SummaryCard icon={<UserX className="size-4" />} label="Suspended" value={counts.suspended} accent="var(--alert)" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs uppercase tracking-widest font-bold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="ml-2 text-[10px] font-mono opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone…"
          className="w-full pl-9 pr-3 py-2 border border-input bg-white text-sm"
        />
      </div>

      <div className="bg-card border border-border overflow-hidden">
        <div className="grid grid-cols-[1.5fr_2fr_0.7fr_1fr_auto] gap-2 px-4 py-2 text-[10px] uppercase tracking-widest font-bold bg-muted/50 border-b border-border">
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {filtered.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground text-center">No users match.</p>
        )}
        {filtered.map((p) => {
          const role = roleByUser.get(p.id) ?? "user";
          const full = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.nickname;
          const isPending = p.status === "pending";
          return (
            <div
              key={p.id}
              className="grid grid-cols-[1.5fr_2fr_0.7fr_1fr_auto] gap-2 px-4 py-3 border-b border-border hover:bg-muted/40 text-sm items-center"
            >
              <button
                onClick={() => setSelectedId(p.id)}
                className="text-left min-w-0"
              >
                <div className="truncate font-medium">{full}</div>
                <div className="text-[10px] text-muted-foreground truncate">{p.nickname}</div>
              </button>
              <button
                onClick={() => setSelectedId(p.id)}
                className="text-left truncate text-muted-foreground"
              >
                {p.email ?? "—"}
              </button>
              <div className="text-xs">{ROLE_LABEL[role]}</div>
              <div>
                <StatusBadge status={p.status} />
              </div>
              <div className="flex justify-end gap-1.5">
                {isPending ? (
                  <>
                    <button
                      onClick={() => quickUpdateStatus(p.id, "approved")}
                      disabled={busyId === p.id}
                      title="Approve"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--forest-deep)" }}
                    >
                      <Check className="size-3" /> Approve
                    </button>
                    <button
                      onClick={() => quickUpdateStatus(p.id, "rejected")}
                      disabled={busyId === p.id}
                      title="Reject"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--alert)" }}
                    >
                      <X className="size-3" /> Reject
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  >
                    Edit →
                  </button>
                )}
              </div>
            </div>
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

function SummaryCard({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: number; accent?: string;
}) {
  return (
    <div className="bg-card border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span style={{ color: accent ?? "var(--muted-foreground)" }}>{icon}</span>
      </div>
      <div className="font-display text-3xl" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const color =
    status === "approved" ? "var(--forest-deep)" :
    status === "rejected" ? "var(--alert)" : "var(--gold)";
  return (
    <span
      className="inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-1 text-white"
      style={{ backgroundColor: color }}
    >
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
          <Field label="Nickname">
            <input value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
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
                <option value="rejected">Suspended</option>
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
