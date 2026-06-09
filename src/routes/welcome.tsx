import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { completeOnboarding } from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

type Phase = "checking" | "ready" | "no-session" | "saving";

const MIN_PASSWORD = 8;

function WelcomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const completeOnboardingFn = useServerFn(completeOnboarding);

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let active = true;

    // The recovery link establishes a session via detectSessionInUrl. We also
    // listen for PASSWORD_RECOVERY in case the event lands after first paint.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session?.user) {
        setEmail(session.user.email ?? "");
        setPhase("ready");
      } else if (event === "SIGNED_OUT") {
        setPhase("no-session");
      }
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session?.user) {
        setEmail(data.session.user.email ?? "");
        setPhase("ready");
      } else {
        // Give detectSessionInUrl a brief moment to consume the URL hash.
        setTimeout(async () => {
          if (!active) return;
          const { data: retry } = await supabase.auth.getSession();
          if (retry.session?.user) {
            setEmail(retry.session.user.email ?? "");
            setPhase("ready");
          } else {
            setPhase("no-session");
          }
        }, 800);
      }
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSetPassword() {
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setPhase("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
      setPhase("ready");
      return;
    }
    try {
      await completeOnboardingFn();
    } catch {
      // Non-fatal: the gate will retry on next load if this didn't stamp.
    }
    await qc.invalidateQueries({ queryKey: ["onboarding-status"] });
    toast.success("Password set — welcome to Major7s");
    navigate({ to: "/home" });
  }

  async function handleResend() {
    const target = resendEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      toast.error("Enter a valid email address");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/welcome`,
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("If that email is registered, a new link is on its way");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--gold)" }}
          >
            Welcome to Major7s
          </p>
          <CardTitle className="font-display text-2xl uppercase mt-1">
            Set your password
          </CardTitle>
        </CardHeader>
        <CardContent>
          {phase === "checking" && (
            <p className="text-sm text-muted-foreground py-4">Preparing your account…</p>
          )}

          {(phase === "ready" || phase === "saving") && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {email ? (
                  <>
                    You're setting up <span className="font-medium text-foreground">{email}</span>.
                    Choose a password to finish and start picking your team.
                  </>
                ) : (
                  <>Choose a password to finish setting up your account.</>
                )}
              </p>

              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Lock className="size-3.5" /> New password
                </Label>
                <Input
                  type="password"
                  className="mt-1"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${MIN_PASSWORD} characters`}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Lock className="size-3.5" /> Confirm password
                </Label>
                <Input
                  type="password"
                  className="mt-1"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSetPassword();
                  }}
                />
              </div>

              <Button
                className="w-full"
                disabled={phase === "saving" || !password || !confirm}
                onClick={handleSetPassword}
              >
                {phase === "saving" ? (
                  "Saving…"
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> Set password &amp; continue
                  </>
                )}
              </Button>
            </div>
          )}

          {phase === "no-session" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This setup link has expired or already been used. Enter your email and we'll send a
                fresh one.
              </p>
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Mail className="size-3.5" /> Email
                </Label>
                <Input
                  type="email"
                  className="mt-1"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <Button
                className="w-full"
                variant="outline"
                disabled={resending || !resendEmail.trim()}
                onClick={handleResend}
              >
                {resending ? "Sending…" : "Send me a new link"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
