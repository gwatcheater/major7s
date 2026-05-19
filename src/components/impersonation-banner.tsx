import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/context/impersonation-context";
import { useTeams } from "@/hooks/use-teams";

interface BannerTeam {
  id: string;
  nickname: string;
  is_primary: boolean;
  created_at: string;
}

export function ImpersonationBanner() {
  const { impersonatingId, impersonatedProfile, stopImpersonation } = useImpersonation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refetch: refetchTeams } = useTeams();

  const storageKey = impersonatingId ? `major7s.activeTeamId:${impersonatingId}` : null;

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["impersonated-teams", impersonatingId],
    enabled: !!impersonatingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, nickname, is_primary, created_at")
        .eq("owner_user_id", impersonatingId!)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BannerTeam[];
    },
  });

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Sync local state with localStorage / fallback to primary when teams arrive
  useEffect(() => {
    if (!impersonatingId || !storageKey) {
      setSelectedTeamId(null);
      return;
    }
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored && teams.some((t) => t.id === stored)) {
      setSelectedTeamId(stored);
      return;
    }
    if (teams.length > 0) {
      const primary = teams.find((t) => t.is_primary) ?? teams[0];
      setSelectedTeamId(primary.id);
      window.localStorage.setItem(storageKey, primary.id);
    }
  }, [impersonatingId, storageKey, teams]);

  if (!impersonatingId) return null;

  const fullName =
    [impersonatedProfile?.first_name, impersonatedProfile?.last_name].filter(Boolean).join(" ") ||
    impersonatedProfile?.nickname ||
    "user";

  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  function handleTeamChange(id: string) {
    if (!storageKey) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, id);
    }
    setSelectedTeamId(id);
    refetchTeams();
    queryClient.invalidateQueries({ queryKey: ["teams"] });
    queryClient.invalidateQueries({ queryKey: ["picks"] });
    queryClient.invalidateQueries({ queryKey: ["roster-status"] });
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-500 text-amber-950 shadow-lg border-t border-amber-700">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">
            ⚠️ SHADOW MODE ACTIVE: Simulating <strong>{fullName}</strong>
            {activeTeam && (
              <>
                {" "}(Team: <strong>{activeTeam.nickname}</strong>)
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Active Lineup Entry:
            </span>
            <Select
              value={selectedTeamId ?? undefined}
              onValueChange={handleTeamChange}
              disabled={isLoading || teams.length === 0}
            >
              <SelectTrigger className="h-8 min-w-[180px] bg-amber-50 text-amber-950 border-amber-700">
                <SelectValue placeholder={isLoading ? "Loading…" : "No teams"} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nickname} {t.is_primary ? "· Primary" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="bg-amber-950 text-amber-50 hover:bg-amber-900"
          onClick={() => {
            stopImpersonation();
            navigate({ to: "/admin" });
          }}
        >
          🛑 Stop Simulation
        </Button>
      </div>
    </div>
  );
}
