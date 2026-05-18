import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

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

const STORAGE_KEY = "major7s.activeTeamId";

export function TeamsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const { data: teams = [], isLoading, refetch } = useQuery({
    queryKey: ["teams", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("owner_user_id", user.id)
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
      window.localStorage.setItem(STORAGE_KEY, primary.id);
    }
  }, [teams, activeTeamId]);

  const setActiveTeamId = (id: string) => {
    setActiveTeamIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    // Invalidate team-scoped queries
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
