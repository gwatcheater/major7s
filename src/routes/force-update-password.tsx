import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { clearMustChangePassword } from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/force-update-password")({
  component: ForceUpdatePasswordPage,
});

type Phase = "checking" | "ready" | "no-session" | "saving";

const MIN_PASSWORD = 8;

function ForceUpdatePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearMustChangeFn = useServerFn(clearMustChangePassword);

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let active = true;

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
      await clearMustChangeFn();
    } catch {
      // Non-fatal: the gate will retry on next load if this didn't clear.
    }
    await qc.invalidateQueries({ queryKey: ["onboarding-status"] });
    toast.success("Password updated");
    navigate({ to: "/home" });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--gold)" }}
          >
            Security
          </p>
          <CardTitle className="font-display text-2xl uppercase mt-1">
            Update your password
          </CardTitle>
        </CardHeader>
        <CardContent>
          {phase === "checking" && (
            <p className="text-sm text-muted-foreground py-4">Checking your session…</p>
          )}

          {(phase === "ready" || phase === "saving") && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {email ? (
                  <>
                    An administrator set a temporary password on{" "}
                    <span className="font-medium text-foreground">{email}</span>. Choose a new
                    password to continue.
                  </>
                ) : (
                  <>
                    An administrator set a temporary password on your account. Choose a new password
                    to continue.
                  </>
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
                    <CheckCircle2 className="size-4" /> Update password &amp; continue
                  </>
                )}
              </Button>
            </div>
          )}

          {phase === "no-session" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your session has expired. Log in again with your temporary password to set a new
                one.
              </p>
              <Button className="w-full" variant="outline" onClick={handleSignOut}>
                Go to login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
