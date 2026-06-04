import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function parseHashParams(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!clean) return out;
  for (const part of clean.split("&")) {
    const [k, v] = part.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return out;
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    // 1. Standard path — listen for Supabase's auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") markReady();
    });

    // 2. If a session already exists (Supabase auto-parsed the URL), use it
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    }).catch(() => { /* fall through to manual recovery */ });

    // 3. Safari-safe fallback — manually parse the URL after a short delay
    //    if the auth listener hasn't fired yet.
    const fallback = async () => {
      if (cancelled || attemptedRef.current) return;
      attemptedRef.current = true;
      try {
        const hashParams = parseHashParams(window.location.hash);
        const searchParams = new URLSearchParams(window.location.search);

        const hashError = hashParams.error_description || hashParams.error;
        const searchError = searchParams.get("error_description") || searchParams.get("error");
        if (hashError || searchError) {
          if (!cancelled) setErrorMsg(hashError || searchError || "Recovery link invalid or expired.");
          return;
        }

        // Implicit flow — tokens in the hash
        const accessToken = hashParams.access_token;
        const refreshToken = hashParams.refresh_token;
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error) {
            markReady();
            // Clean tokens out of the URL
            try { window.history.replaceState({}, document.title, window.location.pathname); } catch { /* ignore */ }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // PKCE flow — code in the query string
        const code = searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            markReady();
            try { window.history.replaceState({}, document.title, window.location.pathname); } catch { /* ignore */ }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // Nothing to work with
        if (!cancelled) setErrorMsg("No recovery token found. Please request a new reset link.");
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : "Could not process recovery link.");
      }
    };

    const timer = window.setTimeout(() => {
      if (!ready) fallback();
    }, 1500);

    // Hard ceiling — surface an actionable error rather than hanging forever
    const hardTimer = window.setTimeout(() => {
      if (!cancelled && !ready) {
        setErrorMsg((prev) => prev ?? "Recovery link took too long to verify. Please request a new one.");
      }
    }, 8000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.clearTimeout(timer);
      window.clearTimeout(hardTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    setSubmitError(null);
    setLoading(true);
    try {
      const { error } = await withTimeout(
        supabase.auth.updateUser({ password }),
        12000,
        "Password update took too long. Please check your connection and try again.",
      );
      if (error) throw error;

      toast.success("Password updated. Please sign in.");
      await withTimeout(
        supabase.auth.signOut(),
        2500,
        "Password updated, but sign-out took too long.",
      ).catch(() => undefined);
      navigate({ to: "/login", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update password. Please try again.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: "var(--ui-bg)" }}>
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl uppercase mb-2">Reset password</h1>
        {errorMsg ? (
          <div className="space-y-4">
            <div className="p-3 border text-xs" style={{ borderColor: "var(--gold)", backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)" }}>
              {errorMsg}
            </div>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="w-full py-3 font-display text-xs uppercase tracking-widest text-white rounded-sm"
              style={{ backgroundColor: "var(--forest-deep)" }}
            >
              Back to login
            </button>
          </div>
        ) : !ready ? (
          <p className="text-sm text-muted-foreground">Waiting for recovery link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {submitError && (
              <div className="p-3 border text-xs" style={{ borderColor: "var(--gold)", backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)" }}>
                {submitError}
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold">New password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold">Confirm</label>
              <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 mt-2 font-display text-xs uppercase tracking-widest text-white rounded-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--forest-deep)" }}>
              {loading ? "..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
