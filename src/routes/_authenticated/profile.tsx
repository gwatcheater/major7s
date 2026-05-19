import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonation } from "@/context/impersonation-context";
import { toast } from "sonner";
import { Loader2, Lock, User, Shield, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfileSettingsView,
});

const PHONE_RE = /^[+]?[\d\s().-]{7,20}$/;

function ProfileSettingsView() {
  const { user } = useAuth();
  const { impersonatingId, getEffectiveUserId } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const qc = useQueryClient();

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["profile", effectiveId],
    enabled: !!effectiveId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles").select("*").eq("id", effectiveId!).single();
      if (error) throw error;
      return data;
    },
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [phone, setPhone] = useState("");
  const [referral, setReferral] = useState("");
  const [saving, setSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.first_name ?? "");
    setLastName(profile.last_name ?? "");
    setTeamName(profile.team_nickname ?? profile.nickname ?? "");
    setPhone(profile.phone ?? "");
    setReferral(profile.referral_name ?? "");
  }, [profile]);

  const initial = useMemo(() => ({
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    teamName: profile?.team_nickname ?? profile?.nickname ?? "",
    phone: profile?.phone ?? "",
    referral: profile?.referral_name ?? "",
  }), [profile]);

  const isDirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    teamName !== initial.teamName ||
    phone !== initial.phone ||
    referral !== initial.referral;

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = "First name is required";
    if (!lastName.trim()) e.lastName = "Last name is required";
    if (!teamName.trim()) e.teamName = "Team name is required";
    if (phone.trim() && !PHONE_RE.test(phone.trim())) e.phone = "Enter a valid phone number";
    return e;
  }, [firstName, lastName, teamName, phone]);

  const isValid = Object.keys(errors).length === 0;

  if (!user) return <div className="p-12">Sign in to manage your profile.</div>;

  async function savePersonal() {
    if (!isValid || !isDirty) return;
    setSaving(true);
    const trimmedTeam = teamName.trim();
    const { error } = await supabase.from("profiles").update({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      referral_name: referral.trim() || null,
      team_nickname: trimmedTeam,
      nickname: trimmedTeam,
    }).eq("id", effectiveId!);
    setSaving(false);
    if (error) { toast.error(`Update failed: ${error.message}`); return; }
    toast.success("Profile updated successfully");
    refetch();
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  async function changePassword() {
    if (!currentPw) { toast.error("Enter your current password"); return; }
    if (newPw.length < 8) { toast.error("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { toast.error("New password and confirmation do not match"); return; }
    setPwSaving(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user!.email ?? "",
      password: currentPw,
    });
    if (signInErr) {
      setPwSaving(false);
      toast.error("Current password is incorrect");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated successfully");
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
  }

  return (
    <div className="p-4 md:p-10 max-w-3xl mx-auto">
      <Link to="/home" className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
      </Link>

      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Your Account</p>
        <h1 className="font-display text-3xl md:text-4xl uppercase mt-1">Profile & Settings</h1>
      </header>

      <div className="flex flex-col gap-6">
        <section className="bg-card border border-border rounded-md p-5 md:p-6">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-display text-lg uppercase">Personal Details</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-6">Your name, contact info, and leaderboard handle.</p>

          {isLoading ? (
            <SkeletonForm />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="First Name" error={errors.firstName}>
                  <Input value={firstName} onChange={setFirstName} placeholder="Jane" autoComplete="given-name" />
                </Field>
                <Field label="Last Name" error={errors.lastName}>
                  <Input value={lastName} onChange={setLastName} placeholder="Doe" autoComplete="family-name" />
                </Field>
              </div>

              <Field
                label="Team Name (Leaderboard Display)"
                error={errors.teamName}
                hint="This unique name will be visible to all players on the master leaderboard."
              >
                <Input value={teamName} onChange={setTeamName} placeholder="The Eagles" />
              </Field>

              <Field label="Mobile Number" error={errors.phone}>
                <Input value={phone} onChange={setPhone} placeholder="+1 555 123 4567" type="tel" inputMode="tel" autoComplete="tel" />
              </Field>

              <Field label="Referral Name" hint="Who told you about us? (optional)">
                <Input value={referral} onChange={setReferral} placeholder="Friend or colleague" />
              </Field>

              <Field label="Email Address">
                <div className="relative">
                  <input
                    value={user.email ?? ""}
                    disabled
                    readOnly
                    className="w-full px-3 py-2.5 pr-9 border border-input bg-muted text-sm rounded-sm text-muted-foreground cursor-not-allowed"
                  />
                  <Lock className="w-3.5 h-3.5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Email address is tied to your account identity and cannot be changed.
                </p>
              </Field>

              <div className="pt-2">
                <button
                  onClick={savePersonal}
                  disabled={!isDirty || !isValid || saving}
                  className="w-full md:w-auto px-6 py-2.5 font-display text-xs uppercase tracking-widest text-white inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
                  style={{ backgroundColor: "var(--forest-deep)" }}
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="bg-card border border-border rounded-md p-5 md:p-6">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-display text-lg uppercase">Account Security</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-6">Update your password. You'll stay signed in on this device.</p>

          <div className="space-y-4">
            <Field label="Current Password">
              <Input value={currentPw} onChange={setCurrentPw} type="password" placeholder="••••••••" autoComplete="current-password" />
            </Field>
            <Field label="New Password" hint="Minimum 8 characters.">
              <Input value={newPw} onChange={setNewPw} type="password" placeholder="••••••••" autoComplete="new-password" />
            </Field>
            <Field label="Confirm New Password">
              <Input value={confirmPw} onChange={setConfirmPw} type="password" placeholder="••••••••" autoComplete="new-password" />
            </Field>

            <div className="pt-2">
              <button
                onClick={changePassword}
                disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                className="w-full md:w-auto px-6 py-2.5 font-display text-xs uppercase tracking-widest text-white inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
                style={{ backgroundColor: "var(--forest-deep)" }}
              >
                {pwSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Change Password
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = "text", inputMode, autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "search" | "url" | "none" | "decimal";
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete={autoComplete}
      className="w-full px-3 py-2.5 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary"
    />
  );
}

function SkeletonForm() {
  return (
    <div className="space-y-4 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-24 bg-muted rounded mb-2" />
          <div className="h-10 w-full bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}
