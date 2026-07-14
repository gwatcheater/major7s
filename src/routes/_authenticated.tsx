import { useLayoutEffect } from "react";
import { createFileRoute, redirect, Outlet, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopBar } from "@/components/mobile-shell";

export const Route = createFileRoute("/_authenticated")({
  // Supabase persists sessions in localStorage, which the server cannot read.
  // Disable SSR for the entire authenticated subtree so the auth gate always
  // runs client-side with access to the session.
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("status, must_change_password")
      .eq("id", data.session.user.id)
      .maybeSingle();
    const status = (profile?.status ?? "pending") as "pending" | "approved" | "rejected";
    if (status !== "approved") {
      await supabase.auth.signOut();
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/force-update-password" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      {/* Header outside the flex wrapper so it is a plain block-level
          sibling.  It starts as position:relative (first paint) and
          switches to sticky after one frame — see MobileTopBar. */}
      <MobileTopBar />
      <div
        className="flex flex-col lg:flex-row lg:min-h-screen w-full"
        style={{ backgroundColor: "var(--ui-bg)" }}
      >
        <AppSidebar />
        <main className="mobile-shell-main flex-1 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </>
  );
}
