import { useEffect } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

function getRecoveryRedirect(href: string) {
  const url = new URL(href, "https://major7s.local");
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash);
  const isRecovery = url.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery";
  if (!isRecovery) return null;

  return `/reset-password${url.search}${url.hash}`;
}

export const Route = createFileRoute("/")({
  // Resolve this route on the client only. The session check below depends on
  // localStorage, which is unavailable during SSR; without `ssr: false` the
  // hydrated match keeps the blank shell and no redirect ever fires (fresh /
  // incognito visitors saw a blank page).
  ssr: false,
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;
    const recoveryRedirect = getRecoveryRedirect(location.href);
    if (recoveryRedirect) throw redirect({ href: recoveryRedirect });
  },
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      navigate({ to: data.session ? "/home" : "/login", replace: true });
    }).catch(() => {
      if (!cancelled) navigate({ to: "/login", replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);
  return null;
}
