import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => {
    const r = typeof s.redirect === "string" && s.redirect ? s.redirect : undefined;
    return r ? { redirect: r } : {};
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTarget } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot-password">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralName, setReferralName] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  async function checkApprovalAndProceed(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      await supabase.auth.signOut();
      throw new Error("Could not verify account status. Please try again.");
    }
    const status = (data?.status ?? "pending") as "pending" | "approved" | "rejected";
    if (status === "approved") {
      const target = redirectTarget?.startsWith("/") ? redirectTarget : "/home";
      navigate({ to: target });
      return;
    }
    await supabase.auth.signOut();
    if (status === "rejected") {
      setPendingMsg("Your account has been suspended. Please contact an administrator.");
    } else {
      setPendingMsg("Your account is awaiting administrator approval.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPendingMsg(null);
    if (mode === "signup" && password.trim().length < 8) {
      toast.error("Password must be at least 8 characters long.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              first_name: firstName,
              last_name: lastName,
              phone,
              referral_name: referralName,
              nickname: nickname || `${firstName} ${lastName}`.trim() || undefined,
            },
          },
        });
        if (error) throw error;
        // Fire-and-forget admin notification (recipient is fixed in the template).
        void fetch("/api/public/hooks/new-user-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch((err) => console.warn("admin-new-user notification failed", err));
        // Sign out — they must wait for admin approval
        await supabase.auth.signOut();
        setPendingMsg("Account created. Your account is awaiting administrator approval — you'll be able to sign in once approved.");
        setMode("signin");
        if (data.user) {
          // Make sure no session lingers
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) await checkApprovalAndProceed(data.user.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally { setLoading(false); }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    if (!email) { toast.error("Enter your email above first"); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setForgotSuccess(true);
    }
  }

  const pageTitle =
    mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : "Reset password";

  const pageSubtitle =
    mode === "signin"
      ? "Welcome back to the clubhouse."
      : mode === "signup"
        ? "Reserve your tee time. Admin approval required."
        : "Enter your email to receive a reset link.";

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ backgroundColor: "var(--ui-bg)" }}>
      <div className="hidden lg:flex flex-col justify-between p-12 text-white" style={{ backgroundColor: "var(--forest-deep)" }}>
        <div className="font-display text-3xl tracking-tight uppercase">
          Major<span style={{ color: "var(--gold)" }}>7s</span>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-widest font-bold mb-3" style={{ color: "var(--gold)" }}>
            Major7s Picks Game
          </p>
          <h1 className="font-display text-5xl leading-[0.95] uppercase">
            Pick. Tweak.<br />
            Suffer. Repeat.
          </h1>
          <p className="mt-6 text-white/60 max-w-md leading-relaxed">
            Welcome to the ultimate test of golfing intuition and emotional endurance. Major7s is a brutal, fast-paced picks game built for the four golf majors. You select seven players. You obsessively tweak your lineup. Then, you watch the leaderboard mercilessly tear your dreams apart.
          </p>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-white/30">
          The Masters · PGA Championship · U.S. Open · The Open
        </div>
      </div>

      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl uppercase mb-1">{pageTitle}</h2>
          <p className="text-sm text-muted-foreground mb-6">{pageSubtitle}</p>

          {pendingMsg && (
            <div className="mb-4 p-3 border text-xs" style={{ borderColor: "var(--gold)", backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)" }}>
              {pendingMsg}
            </div>
          )}

          {mode === "forgot-password" && forgotSuccess ? (
            <div className="space-y-4">
              <div className="p-4 border text-sm" style={{ borderColor: "var(--gold)", backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)" }}>
                Check your inbox for a reset link!
              </div>
              <button
                onClick={() => { setMode("signin"); setForgotSuccess(false); }}
                disabled={loading}
                className="w-full py-3 font-display text-xs uppercase tracking-widest text-white rounded-sm transition-colors disabled:opacity-50"
                style={{ backgroundColor: "var(--forest-deep)" }}
              >
                Back to Login
              </button>
            </div>
          ) : (
            <>
              {mode === "forgot-password" ? (
                <form onSubmit={handleForgotPassword} className="space-y-3">
                  <div>
                    <label htmlFor="email" className="text-[10px] uppercase tracking-widest font-bold">Email</label>
                    <input
                      id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit" disabled={loading}
                    className="w-full py-3 mt-2 font-display text-xs uppercase tracking-widest text-white rounded-sm transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "var(--forest-deep)" }}
                  >
                    {loading ? "..." : "Send Reset Link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    disabled={loading}
                    className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground underline"
                  >
                    Back to Login
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSubmit} method="POST" action="/register" className="space-y-3">
                  {mode === "signup" && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="given-name" className="text-[10px] uppercase tracking-widest font-bold">First name</label>
                          <input type="text" name="given-name" id="given-name" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60}
                            className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
                        </div>
                        <div>
                          <label htmlFor="family-name" className="text-[10px] uppercase tracking-widest font-bold">Last name</label>
                          <input type="text" name="family-name" id="family-name" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60}
                            className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="tel" className="text-[10px] uppercase tracking-widest font-bold">Phone</label>
                        <input type="tel" name="tel" id="tel" autoComplete="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30}
                          className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
                      </div>
                      <div>
                        <label htmlFor="referral-name" className="text-[10px] uppercase tracking-widest font-bold">Referred by</label>
                        <input id="referral-name" name="referral-name" value={referralName} onChange={(e) => setReferralName(e.target.value)} maxLength={120}
                          className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
                      </div>
                      <div>
                        <label htmlFor="nickname" className="text-[10px] uppercase tracking-widest font-bold">Nickname</label>
                        <input id="nickname" name="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60}
                          className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
                      </div>
                    </>
                  )}
                  <div>
                    <label htmlFor="email" className="text-[10px] uppercase tracking-widest font-bold">Email</label>
                    <input
                      id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="text-[10px] uppercase tracking-widest font-bold">Password</label>
                    <input
                      id="password" name="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit" disabled={loading}
                    className="w-full py-3 mt-2 font-display text-xs uppercase tracking-widest text-white rounded-sm transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "var(--forest-deep)" }}
                  >
                    {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
                  </button>
                </form>
              )}

              {mode === "signin" && (
                <button
                  onClick={() => { setMode("forgot-password"); setPendingMsg(null); }}
                  disabled={loading}
                  className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground underline"
                >
                  Forgot password?
                </button>
              )}

              {mode !== "forgot-password" && (
                <p className="mt-6 text-sm text-center text-muted-foreground">
                  {mode === "signin" ? "New to Major7s? " : "Already have an account? "}
                  <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setPendingMsg(null); }} className="font-bold underline">
                    {mode === "signin" ? "Create one" : "Sign in"}
                  </button>
                </p>
              )}
            </>
          )}

          {mode !== "signup" && (
            <p className="mt-4 text-xs text-center text-muted-foreground">
              New accounts require admin approval before sign-in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
