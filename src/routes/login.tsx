import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: (s.redirect as string) || "/home" }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // nickname removed — derived server-side from email
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Account created. Welcome to Major7s.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/home" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally { setLoading(false); }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) { toast.error("Google sign-in failed"); setLoading(false); return; }
    if (result.redirected) return;
    navigate({ to: "/home" });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ backgroundColor: "var(--ui-bg)" }}>
      {/* Hero panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white" style={{ backgroundColor: "var(--forest-deep)" }}>
        <div className="font-display text-3xl tracking-tight uppercase">
          Major<span style={{ color: "var(--gold)" }}>7s</span>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-widest font-bold mb-3" style={{ color: "var(--gold)" }}>
            The Golf Picks Championship
          </p>
          <h1 className="font-display text-5xl leading-[0.95] uppercase">
            Pick your seven.<br />
            Chase the Grand Slam.
          </h1>
          <p className="mt-6 text-white/60 max-w-md leading-relaxed">
            One game engine. Four majors. Two teams per player. A season-long climb tracked in cold, hard numbers.
          </p>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-white/30">
          The Masters · PGA Championship · U.S. Open · The Open
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl uppercase mb-1">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            {mode === "signin" ? "Welcome back to the clubhouse." : "Reserve your tee time."}
          </p>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full mb-4 py-3 px-4 border border-input bg-white hover:bg-secondary text-sm font-semibold rounded-sm transition-colors disabled:opacity-50"
          >
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>

              <label className="text-[10px] uppercase tracking-widest font-bold">Email</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold">Password</label>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                minLength={6}
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

          <p className="mt-6 text-xs text-center text-muted-foreground">
            {mode === "signin" ? "New to Major7s? " : "Already have an account? "}
            <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="font-bold underline">
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
          <p className="mt-4 text-[10px] text-center text-muted-foreground">
            Want admin access? Sign up, then ask an admin to grant the role.
          </p>
        </div>
      </div>
    </div>
  );
}
