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
  return (
    <div
      className="flex flex-col lg:flex-row min-h-screen w-full"
      style={{ backgroundColor: "var(--ui-bg)" }}
    >
      <MobileTopBar />
      <AppSidebar />
      <main className="mobile-shell-main flex-1 min-w-0 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
