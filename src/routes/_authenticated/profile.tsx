import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTeams } from "@/hooks/use-teams";
import { toast } from "sonner";
import { Loader2, User, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

type Tab = "personal" | "security";

const PHONE_RE = /^[+]?[\d\s().-]{7,20}$/;

function ProfilePage() {
  const { user } = useAuth();
  const { teams, refetch: refetchTeams } = useTeams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("personal");

  const { data: profile, isLoading, refetch: refetchProfile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles").select("*").eq("id", user!.id).single();
      if (error) throw error;
      return data;
    },
  });

  // Personal info form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [teamNickname, setTeamNickname] = useState("");
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);

  // Password form state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.first_name ?? "");
    setLastName(profile.last_name ?? "");
    setPhone(profile.phone ?? "");
    setTeamNickname(profile.team_nickname ?? "");
    setNickname(profile.nickname ?? "");
  }, [profile]);

  const initial = useMemo(() => ({
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    phone: profile?.phone ?? "",
    teamNickname: profile?.team_nickname ?? "",
    nickname: profile?.nickname ?? "",
  }), [profile]);

  const isDirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    phone !== initial.phone ||
    teamNickname !== initial.teamNickname ||
    nickname !== initial.nickname;

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = "First name is required";
    if (!lastName.trim()) e.lastName = "Last name is required";
    if (!nickname.trim()) e.nickname = "Display name is required";
    if (phone.trim() && !PHONE_RE.test(phone.trim())) e.phone = "Enter a valid phone number";
    return e;
  }, [firstName, lastName, nickname, phone]);

  const isValid = Object.keys(errors).length === 0;

  if (!user) return <div className="p-12">Sign in to manage your profile.</div>;

  async function savePersonal() {
    if (!isValid || !isDirty) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      team_nickname: teamNickname.trim() || null,
      nickname: nickname.trim(),
    }).eq("id", user!.id);
    setSaving(false);
    if (error) { toast.error(`Update failed: ${error.message}`); return; }
    toast.success("Preferences updated successfully.");
    refetchProfile();
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  async function changePassword() {
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    setNewPassword(""); setConfirmPassword("");
  }

  async function saveTeamName(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Team name required"); return; }
    const { error } = await supabase.from("teams").update({ nickname: trimmed }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Team name updated");
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  return (
    <div className="p-4 md:p-12 max-w-5xl">
      <Link to="/home" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Feed</Link>

      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Your Account</p>
        <h1 className="font-display text-4xl uppercase mt-1">Settings</h1>
      </header>

      <div className="flex gap-8">
        {/* Tabs */}
        <nav className="w-56 shrink-0 space-y-1">
          <TabButton active={tab === "personal"} onClick={() => setTab("personal")} icon={<User className="w-4 h-4" />} label="Personal Info" />
          <TabButton active={tab === "security"} onClick={() => setTab("security")} icon={<Shield className="w-4 h-4" />} label="Account Security" />
        </nav>

        <div className="flex-1 min-w-0">
          {tab === "personal" && (
            <section className="bg-card border border-border p-6">
              <h2 className="font-display text-lg uppercase mb-1">Personal Information</h2>
              <p className="text-xs text-muted-foreground mb-6">Your details and how you appear to others.</p>

              {isLoading ? (
                <SkeletonForm />
              ) : (
                <div className="space-y-4">
                  <Field label="Email" hint="Contact support to change your email address.">
                    <input value={user.email ?? ""} disabled className="w-full px-3 py-2 border border-input bg-muted text-sm rounded-sm" />
                  </Field>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="First Name *" error={errors.firstName}>
                      <Input value={firstName} onChange={setFirstName} placeholder="Jane" />
                    </Field>
                    <Field label="Last Name *" error={errors.lastName}>
                      <Input value={lastName} onChange={setLastName} placeholder="Doe" />
                    </Field>
                  </div>

                  <Field label="Phone Number" error={errors.phone} hint="Optional. Include country code if outside US.">
                    <Input value={phone} onChange={setPhone} placeholder="+1 555 123 4567" type="tel" />
                  </Field>

                  <Field label="Display Name (Leaderboard) *" error={errors.nickname}>
                    <Input value={nickname} onChange={setNickname} placeholder="How you'll appear on the leaderboard" />
                  </Field>

                  <Field label="Team Nickname" hint="Optional. Used for your primary team's display.">
                    <Input value={teamNickname} onChange={setTeamNickname} placeholder="The Eagles" />
                  </Field>

                  <div className="pt-2">
                    <button
                      onClick={savePersonal}
                      disabled={!isDirty || !isValid || saving}
                      className="px-6 py-2.5 font-display text-xs uppercase tracking-widest text-white inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: "var(--forest-deep)" }}
                    >
                      {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save Changes
                    </button>
                  </div>
                </div>
              )}

              {/* Teams sub-section */}
              <div className="mt-10 pt-6 border-t border-border">
                <h3 className="font-display text-sm uppercase mb-1">Team Names</h3>
                <p className="text-xs text-muted-foreground mb-4">Each team gets its own leaderboard entry.</p>
                <div className="space-y-3">
                  {teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
                  {teams.map((t) => (
                    <TeamRow key={t.id} id={t.id} initialName={t.nickname} isPrimary={t.is_primary} onSave={saveTeamName} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === "security" && (
            <section className="bg-card border border-border p-6 max-w-xl">
              <h2 className="font-display text-lg uppercase mb-1">Account Security</h2>
              <p className="text-xs text-muted-foreground mb-6">Update your password. You'll stay signed in on this device.</p>

              <div className="space-y-4">
                <Field label="New Password" hint="Minimum 8 characters.">
                  <Input value={newPassword} onChange={setNewPassword} type="password" placeholder="••••••••" />
                </Field>
                <Field label="Confirm Password">
                  <Input value={confirmPassword} onChange={setConfirmPassword} type="password" placeholder="••••••••" />
                </Field>
                <button
                  onClick={changePassword}
                  disabled={pwSaving || !newPassword || !confirmPassword}
                  className="px-6 py-2.5 font-display text-xs uppercase tracking-widest text-white inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "var(--forest-deep)" }}
                >
                  {pwSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Update Password
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-widest font-bold border-l-2 transition-colors ${
        active ? "border-l-[var(--gold)] bg-muted text-foreground" : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary"
    />
  );
}

function SkeletonForm() {
  return (
    <div className="space-y-4 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-24 bg-muted rounded mb-2" />
          <div className="h-9 w-full bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

function TeamRow({ id, initialName, isPrimary, onSave }: { id: string; initialName: string; isPrimary: boolean; onSave: (id: string, name: string) => void }) {
  const [name, setName] = useState(initialName);
  useEffect(() => { setName(initialName); }, [initialName]);
  const dirty = name.trim() !== initialName;
  return (
    <div className="flex flex-wrap items-end gap-3 border border-border p-3">
      <div className="flex-1 min-w-[220px]">
        <label className="text-[10px] uppercase tracking-widest font-bold block mb-1 text-muted-foreground">
          {isPrimary ? "Primary Team" : "Secondary Team"}
        </label>
        <Input value={name} onChange={setName} />
      </div>
      <button
        onClick={() => onSave(id, name)}
        disabled={!dirty}
        className="px-4 py-2 font-display text-[10px] uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Save
      </button>
    </div>
  );
}
