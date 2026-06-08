import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Wraps authenticated content and enforces "password always set on first login".
 *
 * A user whose profile has no `onboarded_at` is bounced to /welcome and cannot
 * reach app routes until they've set a password (which stamps onboarded_at via
 * the completeOnboarding server fn). Existing users were backfilled by the SQL
 * migration, so this only catches freshly provisioned, never-onboarded accounts.
 *
 * Usage — in src/routes/_authenticated.tsx, wrap the outlet:
 *
 *   import { OnboardingGate } from "@/components/onboarding-gate";
 *   ...
 *   component: () => (
 *     <OnboardingGate>
 *       <Outlet />
 *     </OnboardingGate>
 *   ),
 *
 * Keep /welcome OUTSIDE _authenticated so it isn't gated (no redirect loop).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-status"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return { needs: false as const };
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("onboarded_at")
        .eq("id", sess.session.user.id)
        .maybeSingle();
      if (error) throw error;
      return { needs: !prof?.onboarded_at };
    },
  });

  const needs = !!data?.needs;

  useEffect(() => {
    if (!isLoading && needs && pathname !== "/welcome") {
      navigate({ to: "/welcome" });
    }
  }, [isLoading, needs, pathname, navigate]);

  if (isLoading) return null;
  if (needs) return null;
  return <>{children}</>;
}
