import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useImpersonation } from "@/context/impersonation-context";

export interface Team {
  id: string;
  owner_user_id: string;
  nickname: string;
  is_primary: boolean;
}

interface TeamsState {
  teams: Team[];
  activeTeam: Team | null;
  setActiveTeamId: (id: string) => void;
  loading: boolean;
  refetch: () => void;
}

const TeamsContext = createContext<TeamsState>({
  teams: [],
  activeTeam: null,
  setActiveTeamId: () => {},
  loading: false,
  refetch: () => {},
});

const STORAGE_KEY_BASE = "major7s.activeTeamId";

export function TeamsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const effectiveId = getEffectiveUserId(user?.id);
  const storageKey = effectiveId ? `${STORAGE_KEY_BASE}:${effectiveId}` : STORAGE_KEY_BASE;
  const queryClient = useQueryClient();
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(storageKey);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActiveTeamIdState(window.localStorage.getItem(storageKey));
  }, [storageKey]);

  const { data: teams = [], isLoading, refetch } = useQuery({
    queryKey: ["teams", effectiveId],
    enabled: !!effectiveId,
    queryFn: async () => {
      if (!effectiveId) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("owner_user_id", effectiveId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Team[];
    },
  });

  useEffect(() => {
    if (teams.length === 0) return;
    if (!activeTeamId || !teams.find((t) => t.id === activeTeamId)) {
      const primary = teams.find((t) => t.is_primary) ?? teams[0];
      setActiveTeamIdState(primary.id);
      window.localStorage.setItem(storageKey, primary.id);
    }
  }, [teams, activeTeamId, storageKey]);

  const setActiveTeamId = (id: string) => {
    setActiveTeamIdState(id);
    window.localStorage.setItem(storageKey, id);
    queryClient.invalidateQueries({ queryKey: ["picks"] });
    queryClient.invalidateQueries({ queryKey: ["roster-status"] });
  };

  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null;

  return (
    <TeamsContext.Provider
      value={{ teams, activeTeam, setActiveTeamId, loading: isLoading, refetch }}
    >
      {children}
    </TeamsContext.Provider>
  );
}

export function useTeams() {
  return useContext(TeamsContext);
}
