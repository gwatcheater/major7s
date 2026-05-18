import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTeams } from "@/hooks/use-teams";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const { teams, refetch: refetchTeams } = useTeams();
  const qc = useQueryClient();

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles").select("*").eq("id", user!.id).single();
      if (error) throw error;
      return data;
    },
  });

  const [nickname, setNickname] = useState("");
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});

  useEffect(() => { if (profile) setNickname(profile.nickname ?? ""); }, [profile]);
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const t of teams) init[t.id] = t.nickname;
    setTeamNames(init);
  }, [teams]);

  if (!user) return <div className="p-12">Sign in to manage your profile.</div>;

  async function saveProfile() {
    if (!nickname.trim()) { toast.error("Display name required"); return; }
    const { error } = await supabase.from("profiles")
      .update({ nickname: nickname.trim() }).eq("id", user!.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile updated");
    refetchProfile();
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  async function saveTeam(id: string) {
    const name = (teamNames[id] ?? "").trim();
    if (!name) { toast.error("Team name required"); return; }
    const { error } = await supabase.from("teams").update({ nickname: name }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Team name updated");
    refetchTeams();
    qc.invalidateQueries({ queryKey: ["teams"] });
  }

  return (
    <div className="p-8 md:p-12 max-w-3xl">
      <Link to="/home" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">← Feed</Link>

      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Your Profile</p>
        <h1 className="font-display text-4xl uppercase mt-1">Profile & Teams</h1>
      </header>

      {/* Personal details */}
      <section className="bg-card border border-border p-6 mb-8">
        <h2 className="font-display text-lg uppercase mb-4">Personal Details</h2>
        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Email</label>
            <input value={user.email ?? ""} disabled className="w-full px-3 py-2 border border-input bg-muted text-sm rounded-sm" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">Display Name (Leaderboard)</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="How you'll appear on the leaderboard"
              className="w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={saveProfile}
            className="px-6 py-2.5 font-display text-xs uppercase tracking-widest text-white"
            style={{ backgroundColor: "var(--forest-deep)" }}
          >
            Save Profile
          </button>
        </div>
      </section>

      {/* Teams */}
      <section className="bg-card border border-border p-6">
        <h2 className="font-display text-lg uppercase mb-1">Team Names</h2>
        <p className="text-xs text-muted-foreground mb-4">Each team gets its own leaderboard entry.</p>
        <div className="space-y-3">
          {teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
          {teams.map((t) => (
            <div key={t.id} className="flex flex-wrap items-end gap-3 border border-border p-3">
              <div className="flex-1 min-w-[220px]">
                <label className="text-[10px] uppercase tracking-widest font-bold block mb-1 text-muted-foreground">
                  {t.is_primary ? "Primary Team" : "Secondary Team"}
                </label>
                <input
                  value={teamNames[t.id] ?? ""}
                  onChange={(e) => setTeamNames((s) => ({ ...s, [t.id]: e.target.value }))}
                  className="w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={() => saveTeam(t.id)}
                className="px-4 py-2 font-display text-[10px] uppercase tracking-widest border border-border hover:bg-muted"
              >
                Save
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
