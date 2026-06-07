import { useEffect } from "react";
import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopBar } from "@/components/mobile-shell";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
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
  useEffect(() => {
    // FIX: Chrome iOS does not fully resolve viewport dimensions on first paint.
    // Rotating the device or pinching the screen triggers a resize event that
    // forces a reflow and corrects the layout. This effect replicates that by
    // briefly toggling a style property to trigger the same reflow programmatically,
    // immediately after the component mounts. The timeout of 0 ensures it runs
    // after the browser's initial paint so it doesn't block rendering.
    const timeout = setTimeout(() => {
      document.documentElement.style.overflow = "hidden";
      // Reading offsetHeight forces the browser to perform a synchronous reflow
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      document.documentElement.offsetHeight;
      document.documentElement.style.overflow = "";
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="flex flex-col lg:flex-row min-h-screen w-full" style={{ backgroundColor: "var(--ui-bg)" }}>
      <MobileTopBar />
      <AppSidebar />
      <main className="flex-1 min-w-0 overflow-x-hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <Outlet />
      </main>
    </div>
  );
}
