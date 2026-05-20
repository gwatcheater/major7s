import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "major7s.shadow";

interface ImpersonatedProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string;
}

interface ImpersonationState {
  impersonatingId: string | null;
  isAdminSession: boolean;
  impersonatedProfile: ImpersonatedProfile | null;
  startImpersonation: (userId: string) => void;
  stopImpersonation: () => void;
  getEffectiveUserId: (sessionUserId: string | undefined | null) => string | undefined;
}

const ImpersonationContext = createContext<ImpersonationState>({
  impersonatingId: null,
  isAdminSession: false,
  impersonatedProfile: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
  getEffectiveUserId: (id) => id ?? undefined,
});

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [impersonatingId, setImpersonatingId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(STORAGE_KEY);
  });

  // Auto-clear if the real session is no longer admin
  useEffect(() => {
    if (!isAdmin && impersonatingId) {
      setImpersonatingId(null);
      if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [isAdmin, impersonatingId]);

  const { data: impersonatedProfile = null } = useQuery({
    queryKey: ["impersonated-profile", impersonatingId],
    enabled: !!impersonatingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, nickname, team_nickname")
        .eq("id", impersonatingId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ImpersonatedProfile | null) ?? null;
    },
  });

  const invalidateScopedQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["picks"] });
    qc.invalidateQueries({ queryKey: ["roster-status"] });
    qc.invalidateQueries({ queryKey: ["missing-picks"] });
  }, [qc]);

  const startImpersonation = useCallback(
    (userId: string) => {
      if (!isAdmin) return;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(STORAGE_KEY, userId);
        // Drop any prior active-team selection so the impersonated user's primary team is picked
        for (const k of Object.keys(window.localStorage)) {
          if (k.startsWith("major7s.activeTeamId")) window.localStorage.removeItem(k);
        }
      }
      setImpersonatingId(userId);
      invalidateScopedQueries();
    },
    [isAdmin, invalidateScopedQueries],
  );

  const stopImpersonation = useCallback(() => {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
    setImpersonatingId(null);
    invalidateScopedQueries();
  }, [invalidateScopedQueries]);

  const getEffectiveUserId = useCallback(
    (sessionUserId: string | undefined | null) => impersonatingId ?? sessionUserId ?? undefined,
    [impersonatingId],
  );

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatingId,
        isAdminSession: isAdmin,
        impersonatedProfile,
        startImpersonation,
        stopImpersonation,
        getEffectiveUserId,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
