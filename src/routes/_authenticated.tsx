import { useEffect, useLayoutEffect, useRef } from "react";
import { createFileRoute, redirect, Outlet, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopBar } from "@/components/mobile-shell";
import { OnboardingGate } from "@/components/onboarding-gate";

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
  const mainRef = useRef<HTMLElement | null>(null);

  const resetScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
      mainRef.current.scrollLeft = 0;
    }
  };

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    resetScroll();
    requestAnimationFrame(resetScroll);

    return undefined;
  }, [pathname]);

  useEffect(() => {
    const timers = [50, 150, 350, 700, 1200].map((delay) => setTimeout(resetScroll, delay));
    window.addEventListener("load", resetScroll, { once: true });

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("load", resetScroll);
    };
  }, [pathname]);

  return (
    <div
      className="flex flex-col lg:flex-row min-h-screen w-full"
      style={{ backgroundColor: "var(--ui-bg)" }}
    >
      <MobileTopBar />
      <AppSidebar />
      <main ref={mainRef} className="mobile-shell-main flex-1 min-w-0 overflow-x-hidden">
        <OnboardingGate>
          <Outlet />
        </OnboardingGate>
      </main>
    </div>
  );
}
