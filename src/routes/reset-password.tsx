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

type UrlSnapshot = { search: string; hash: string };

function mergeSearchParams(target: URLSearchParams, raw: string) {
  const clean = raw.startsWith("?") ? raw.slice(1) : raw;
  if (!clean.includes("=")) return;
  new URLSearchParams(clean).forEach((value, key) => {
    if (!target.has(key)) target.set(key, value);
  });
}

function readRecoveryParams(initialUrl: UrlSnapshot | null) {
  const currentUrl: UrlSnapshot =
    typeof window === "undefined" ? { search: "", hash: "" } : window.location;
  const searchParams = new URLSearchParams(currentUrl.search);
  const hashParams = parseHashParams(currentUrl.hash);

  for (const url of [initialUrl, currentUrl]) {
    if (!url) continue;
    mergeSearchParams(searchParams, url.search);
    const cleanHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashQuery = cleanHash.includes("?")
      ? cleanHash.slice(cleanHash.indexOf("?") + 1)
      : cleanHash;
    mergeSearchParams(searchParams, hashQuery);
    Object.assign(hashParams, { ...parseHashParams(hashQuery), ...parseHashParams(url.hash) });
  }

  return { searchParams, hashParams };
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
  const initialUrlRef = useRef<UrlSnapshot | null>(
    typeof window === "undefined"
      ? null
      : { search: window.location.search, hash: window.location.hash },
  );
  const attemptedRef = useRef(false);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const markReady = () => {
      readyRef.current = true;
      if (!cancelled) {
        setErrorMsg(null);
        setReady(true);
      }
    };

    const recheckSession = async () => {
      if (readyRef.current || cancelled) return false;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          markReady();
          return true;
        }
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          markReady();
          return true;
        }
      } catch {
        /* continue polling/manual parsing */
      }
      return false;
    };

    // 1. Standard path — listen for Supabase's auth events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") markReady();
    });

    // 2. If a session already exists (Supabase auto-parsed the URL), use it
    void recheckSession();

    // 3. Safari-safe fallback — manually parse the URL after a short delay
    //    if the auth listener hasn't fired yet.
    const fallback = async () => {
      if (cancelled || attemptedRef.current || readyRef.current) return;
      try {
        if (await recheckSession()) return;

        const { hashParams, searchParams } = readRecoveryParams(initialUrlRef.current);

        const hashError = hashParams.error_description || hashParams.error;
        const searchError = searchParams.get("error_description") || searchParams.get("error");
        if (hashError || searchError) {
          attemptedRef.current = true;
          if (!cancelled)
            setErrorMsg(hashError || searchError || "Recovery link invalid or expired.");
          return;
        }

        // Implicit flow — tokens in the hash
        const accessToken = hashParams.access_token;
        const refreshToken = hashParams.refresh_token;
        if (accessToken && refreshToken) {
          attemptedRef.current = true;
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error) {
            markReady();
            // Clean tokens out of the URL
            try {
              window.history.replaceState({}, document.title, window.location.pathname);
            } catch {
              /* ignore */
            }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // PKCE flow — code in the query string
        const code = searchParams.get("code");
        if (code) {
          attemptedRef.current = true;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            markReady();
            try {
              window.history.replaceState({}, document.title, window.location.pathname);
            } catch {
              /* ignore */
            }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // New email link format — token_hash + type in query or hash
        const tokenHash = searchParams.get("token_hash") || hashParams.token_hash;
        const otpType = (searchParams.get("type") || hashParams.type || "recovery") as "recovery";
        if (tokenHash) {
          attemptedRef.current = true;
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          if (!error) {
            markReady();
            try {
              window.history.replaceState({}, document.title, window.location.pathname);
            } catch {
              /* ignore */
            }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // Legacy token + type
        const legacyToken = searchParams.get("token") || hashParams.token;
        if (legacyToken) {
          attemptedRef.current = true;
          const { error } = await supabase.auth.verifyOtp({
            token_hash: legacyToken,
            type: otpType,
          });
          if (!error) {
            markReady();
            try {
              window.history.replaceState({}, document.title, window.location.pathname);
            } catch {
              /* ignore */
            }
            return;
          }
          if (!cancelled) setErrorMsg(error.message);
          return;
        }

        // Nothing to work with yet; keep polling because mobile browsers can finish
        // auth storage writes after the page becomes visible.
      } catch (err) {
        if (!cancelled)
          setErrorMsg(err instanceof Error ? err.message : "Could not process recovery link.");
      }
    };

    const handleResume = () => void recheckSession();
    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    const timer = window.setTimeout(() => {
      if (!readyRef.current) fallback();
    }, 250);

    const pollTimer = window.setInterval(() => {
      if (readyRef.current || cancelled) {
        window.clearInterval(pollTimer);
        return;
      }
      void fallback();
    }, 500);

    // Hard ceiling — surface an actionable error rather than hanging forever
    const hardTimer = window.setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        setErrorMsg(
          (prev) => prev ?? "Recovery link could not be verified. Please request a new reset link.",
        );
      }
    }, 9000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      window.clearTimeout(timer);
      window.clearInterval(pollTimer);
      window.clearTimeout(hardTimer);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
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
      const message =
        err instanceof Error ? err.message : "Could not update password. Please try again.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ backgroundColor: "var(--ui-bg)" }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl uppercase mb-2">Reset password</h1>
        {errorMsg ? (
          <div className="space-y-4">
            <div
              className="p-3 border text-xs"
              style={{
                borderColor: "var(--gold)",
                backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)",
              }}
            >
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
              <div
                className="p-3 border text-xs"
                style={{
                  borderColor: "var(--gold)",
                  backgroundColor: "color-mix(in oklab, var(--gold) 12%, transparent)",
                }}
              >
                {submitError}
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold">
                New password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold">Confirm</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 border border-input bg-white rounded-sm text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 mt-2 font-display text-xs uppercase tracking-widest text-white rounded-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--forest-deep)" }}
            >
              {loading ? "..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
