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
      .select("status")
      .eq("id", data.session.user.id)
      .maybeSingle();
    const status = (profile?.status ?? "pending") as "pending" | "approved" | "rejected";
    if (status !== "approved") {
      await supabase.auth.signOut();
      throw redirect({ to: "/login", search: { redirect: location.href } });
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
      {/* Render outside the flex wrapper so Chrome iOS (WKWebView) does not
          include the header in its flex-column first-paint calculation.
          The header is sticky (not fixed) so it stays in normal document flow
          and naturally pushes content below it — no spacer div needed. */}
      <MobileTopBar />
      <div
        className="flex flex-col lg:flex-row min-h-screen w-full"
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
