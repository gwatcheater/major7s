import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Trophy, Archive, BarChart3, Crown, Shield, LogOut, ChevronDown, AlertTriangle, Plus, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTeams } from "@/hooks/use-teams";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const nav = [
  { label: "Live & Upcoming", to: "/home", icon: Trophy },
  { label: "Event Archive", to: "/archive", icon: Archive },
  { label: "Global Stats", to: "/stats", icon: BarChart3 },
  { label: "Hall of Fame", to: "/hall-of-fame", icon: Crown },
];

export function AppSidebar({ variant = "fixed" }: { variant?: "fixed" | "drawer" } = {}) {
  const isDrawer = variant === "drawer";
  const { user, isAdmin } = useAuth();
  const { teams, activeTeam, setActiveTeamId, refetch } = useTeams();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  // Check which teams have missing picks for any open tournament
  const { data: missingPicksTeams = [] } = useQuery({
    queryKey: ["missing-picks", teams.map((t) => t.id).join(",")],
    enabled: teams.length > 0,
    queryFn: async () => {
      const { data: openTournaments } = await supabase
        .from("tournaments")
        .select("id, name")
        .in("status", ["open"]);
      if (!openTournaments || openTournaments.length === 0) return [];

      const result: { team: string; tournament: string }[] = [];
      for (const t of teams) {
        for (const tour of openTournaments) {
          const { count } = await supabase
            .from("picks")
            .select("*", { count: "exact", head: true })
            .eq("team_id", t.id)
            .eq("tournament_id", tour.id);
          if ((count ?? 0) < 7) {
            result.push({ team: t.nickname, tournament: tour.name });
          }
        }
      }
      return result;
    },
  });

  async function handleSignOut() {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate({ to: "/login" });
  }

  async function handleAddTeam() {
    if (!user || !activeTeam) return;
    const baseName = teams.find((t) => t.is_primary)?.nickname ?? "Team";
    const next = teams.length + 1;
    const nickname = next === 2 ? `${baseName} 2` : `${baseName} ${next}`;
    const { error } = await supabase.from("teams").insert({
      owner_user_id: user.id,
      nickname,
      is_primary: false,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Created ${nickname}`);
      refetch();
    }
  }

  return (
    <aside
      className={
        isDrawer
          ? "h-full w-full flex flex-col text-white"
          : "sticky top-0 h-screen w-72 shrink-0 hidden md:flex flex-col text-white z-50"
      }
      style={{ backgroundColor: "var(--forest-deep)" }}
    >
      {/* Logo */}
      <div className="p-6">
        <Link to="/home" className="font-display text-2xl tracking-tight uppercase">
          Major<span style={{ color: "var(--gold)" }}>7s</span>
        </Link>
      </div>

      {/* Team switcher */}
      <div className="px-4 mb-6">
        <div className="rounded-sm p-3 border border-white/10" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
              Active Profile
            </label>
            <button
              onClick={handleAddTeam}
              title="Add secondary team"
              className="text-white/40 hover:text-white transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="size-7 rounded-sm grid place-items-center font-display text-[10px] shrink-0" style={{ backgroundColor: "var(--gold)", color: "var(--forest-deep)" }}>
                {(activeTeam?.nickname ?? "?").slice(0, 2).toUpperCase()}
              </div>
              <span className="text-sm font-semibold text-white truncate">
                {activeTeam?.nickname ?? "No team"}
              </span>
            </div>
            <ChevronDown className={cn("size-4 text-white/40 transition-transform", open && "rotate-180")} />
          </button>

          {open && teams.length > 1 && (
            <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
              {teams.filter((t) => t.id !== activeTeam?.id).map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveTeamId(t.id); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/5 rounded-sm transition-colors"
                >
                  {t.nickname}
                </button>
              ))}
            </div>
          )}

          {missingPicksTeams.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
              {missingPicksTeams.slice(0, 3).map((m, i) => (
                <div key={i} className="flex items-start gap-2 animate-pulse">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" style={{ color: "var(--alert)" }} />
                  <p className="text-[11px] leading-tight text-white/80">
                    <span className="font-semibold">{m.team}</span> has missing picks!
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-1">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = path === item.to || (item.to !== "/home" && path.startsWith(item.to));
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-sm transition-colors",
                active
                  ? "font-bold"
                  : "text-white/60 hover:text-white"
              )}
              style={active ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
            >
              <Icon className="size-3.5" />
              <span className="text-xs tracking-tight uppercase">{item.label}</span>
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            to="/admin"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-sm transition-colors mt-4",
              path.startsWith("/admin") ? "font-bold" : "text-white/60 hover:text-white"
            )}
            style={path.startsWith("/admin") ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
          >
            <Shield className="size-3.5" />
            <span className="text-xs tracking-tight uppercase">Admin Panel</span>
          </Link>
        )}
      </nav>

      {/* User / admin toggle / sign out */}
      <div className="p-4 mt-auto border-t border-white/10" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
        {isAdmin && (
          <div className="flex items-center bg-black/30 p-1 rounded-sm border border-white/10 mb-3">
            <button
              onClick={() => setAdminMode(false)}
              className={cn(
                "flex-1 py-1 text-[10px] font-bold uppercase tracking-widest",
                !adminMode ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              User
            </button>
            <button
              onClick={() => { setAdminMode(true); navigate({ to: "/admin" }); }}
              className={cn(
                "flex-1 py-1 text-[10px] font-bold uppercase tracking-widest",
                adminMode ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              Admin
            </button>
          </div>
        )}
        <Link to="/profile" className="flex items-center gap-3 px-1 hover:opacity-80 transition-opacity">
          <div className="size-9 rounded-full bg-white/10 border border-white/20 grid place-items-center font-display text-xs text-white/80">
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-white uppercase truncate">{user?.email?.split("@")[0] ?? "Guest"}</div>
            <div className="text-[10px] text-white/40">{isAdmin ? "Administrator" : "Player"} · Edit profile</div>
          </div>
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSignOut(); }} className="text-white/40 hover:text-white transition-colors" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </Link>
      </div>
    </aside>
  );
}
