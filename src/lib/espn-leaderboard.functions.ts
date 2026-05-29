import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  tournament_id: z.string().uuid(),
  espn_event_id: z.string().min(1).max(64),
});

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePositionNumeric(displayName: string | undefined | null): number | null {
  if (!displayName) return null;
  const stripped = displayName.replace(/^T/i, "").trim();
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) ? n : null;
}

export const importEspnLeaderboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Admin check using service-role client
    const { data: roleRow, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin only");

    // Fetch from ESPN
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${encodeURIComponent(data.espn_event_id)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `ESPN API responded ${res.status}`, imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[] };
    }
    const payload: any = await res.json();
    const event = payload?.events?.[0];
    const comp = event?.competitions?.[0];
    if (!comp) {
      return { error: "Unexpected ESPN response (no competition)", imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[] };
    }
    const completed = event?.status?.type?.completed === true;
    if (!completed) {
      return { error: "Tournament is not yet final on ESPN", imported: 0, matched: 0, unmatched: 0, unmatched_names: [] as string[] };
    }

    // Local golfers for name match
    const { data: golfers, error: gErr } = await supabaseAdmin
      .from("golfers")
      .select("id, golfer_name")
      .eq("tournament_id", data.tournament_id);
    if (gErr) throw new Error(gErr.message);
    const golferByName = new Map<string, string>();
    for (const g of golfers ?? []) {
      golferByName.set(normalizeName(g.golfer_name), g.id);
    }

    const competitors: any[] = comp?.competitors ?? [];
    const rows: any[] = [];
    const unmatchedNames: string[] = [];
    let matched = 0;

    for (const c of competitors) {
      const espnPlayerId = String(c?.id ?? "");
      const displayName: string = c?.athlete?.displayName ?? "";
      if (!espnPlayerId || !displayName) continue;

      const country: string | null =
        c?.athlete?.flag?.alt ?? c?.athlete?.birthPlace?.countryAbbreviation ?? null;

      const positionDisplay: string | null = c?.status?.position?.displayName ?? null;
      const isTie: boolean = c?.status?.position?.isTie === true;
      const statusType: string | null = c?.status?.type?.name ?? null;
      const positionNumeric =
        statusType === "STATUS_CUT" || statusType === "STATUS_WITHDRAWN" || positionDisplay === "-"
          ? null
          : parsePositionNumeric(positionDisplay);

      const totalStrokes: number | null =
        typeof c?.score?.value === "number" ? c.score.value : null;

      let scoreToPar: number | null = null;
      const stats: any[] = c?.statistics ?? [];
      for (const s of stats) {
        if (s?.name === "scoreToPar" && typeof s?.value === "number") {
          scoreToPar = s.value;
          break;
        }
      }

      const rounds: Record<number, number | null> = { 1: null, 2: null, 3: null, 4: null };
      const linescores: any[] = c?.linescores ?? [];
      for (const ls of linescores) {
        const period = ls?.period;
        if (period >= 1 && period <= 4 && typeof ls?.value === "number") {
          rounds[period] = ls.value;
        }
      }

      const golferId = golferByName.get(normalizeName(displayName)) ?? null;
      if (golferId) matched++;
      else unmatchedNames.push(displayName);

      rows.push({
        tournament_id: data.tournament_id,
        golfer_id: golferId,
        espn_player_id: espnPlayerId,
        espn_display_name: displayName,
        country,
        position_display: positionDisplay,
        position_numeric: positionNumeric,
        is_tie: isTie,
        status_type: statusType,
        total_strokes: totalStrokes,
        score_to_par: scoreToPar,
        round_1: rounds[1],
        round_2: rounds[2],
        round_3: rounds[3],
        round_4: rounds[4],
        imported_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      return { error: "No competitors found", imported: 0, matched: 0, unmatched: 0, unmatched_names: [] };
    }

    const { error: upErr } = await supabaseAdmin
      .from("tournament_leaderboard")
      .upsert(rows, { onConflict: "tournament_id,espn_player_id" });
    if (upErr) throw new Error(upErr.message);

    return {
      imported: rows.length,
      matched,
      unmatched: unmatchedNames.length,
      unmatched_names: unmatchedNames,
      error: null as string | null,
    };
  });
