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
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col lg:flex-row min-h-screen w-full" style={{ backgroundColor: "var(--ui-bg)" }}>
      <MobileTopBar />
      <AppSidebar />
      {/* FIX: mt-16 on mobile pushes main below the sticky MobileTopBar (h-16 = 64px).
          A sticky element still occupies space in the flow on first render but
          Chrome iOS doesn't always account for it correctly, so we use margin-top
          as a guaranteed offset that doesn't depend on Chrome resolving sticky
          positioning before first paint. lg:mt-0 removes it on desktop. */}
      <main className="flex-1 min-w-0 overflow-x-hidden mt-16 lg:mt-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <Outlet />
      </main>
    </div>
  );
}
