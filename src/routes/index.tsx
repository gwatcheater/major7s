import { createFileRoute, redirect } from "@tanstack/react-router";
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
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const recoveryRedirect = getRecoveryRedirect(location.href);
    if (recoveryRedirect) throw redirect({ href: recoveryRedirect });
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
    throw redirect({ to: "/login" });
  },
});
