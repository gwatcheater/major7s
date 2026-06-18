import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

function isRecoveryUrl() {
  if (typeof window === "undefined") return false;
  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash);
  return searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery";
}

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    if (isRecoveryUrl()) {
      window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
    throw redirect({ to: "/login" });
  },
});
