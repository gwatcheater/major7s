import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchEspnEventInfo, importEspnLeaderboard } from "@/lib/espn-leaderboard.functions";

const inputCls =
  "w-full px-3 py-2 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold block mb-1">{label}</label>
      {children}
    </div>
  );
}

export function EspnLeaderboardSection({
  tournamentId,
  initialEspnEventId,
  onSaved,
}: {
  tournamentId: string;
  initialEspnEventId: string;
  onSaved?: () => void;
}) {
  const [espnId, setEspnId] = useState(initialEspnEventId ?? "");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    error?: string | null;
    imported?: number;
    matched?: number;
    unmatched?: number;
    unmatched_names?: string[];
  } | null>(null);
  const [eventPreview, setEventPreview] = useState<{
    name: string | null;
    error: string | null;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Tournament field top 10 (real golfers, score-to-par) + when the
  // leaderboard was last pulled from ESPN — shown below the import button
  // so you can eyeball the result without leaving this panel. This reads
  // tournament_leaderboard directly; it has nothing to do with Major7s
  // team scoring, which lives elsewhere.
  const [topGolfers, setTopGolfers] = useState<
    { name: string; position: string; scoreToPar: string | null }[]
  >([]);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [loadingLeaderboardPreview, setLoadingLeaderboardPreview] = useState(false);

  const importFn = useServerFn(importEspnLeaderboard);
  const fetchEventInfoFn = useServerFn(fetchEspnEventInfo);
  const qc = useQueryClient();

  useEffect(() => {
    setEspnId(initialEspnEventId ?? "");
  }, [initialEspnEventId, tournamentId]);

  async function loadLeaderboardPreview() {
    setLoadingLeaderboardPreview(true);
    try {
      const { data, error } = await supabase
        .from("tournament_leaderboard")
        .select("espn_display_name, position_display, score_to_par, imported_at")
        .eq("tournament_id", tournamentId)
        .order("position_numeric", { ascending: true, nullsFirst: false })
        .limit(10);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      setTopGolfers(
        rows.map((r) => ({
          name: r.espn_display_name as string,
          position: (r.position_display as string) ?? "-",
          scoreToPar: (r.score_to_par as string | null) ?? null,
        })),
      );
      const latest = rows.reduce<string | null>(
        (max, r) => (!max || (r.imported_at && r.imported_at > max) ? r.imported_at : max),
        null,
      );
      setLastImportedAt(latest);
    } catch {
      setTopGolfers([]);
    } finally {
      setLoadingLeaderboardPreview(false);
    }
  }

  useEffect(() => {
    loadLeaderboardPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  async function loadPreview(id: string) {
    setLoadingPreview(true);
    try {
      const res = await fetchEventInfoFn({ data: { espn_event_id: id } });
      setEventPreview(res as { name: string | null; error: string | null });
    } catch {
      setEventPreview({ name: null, error: "Failed to fetch event info" });
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    const id = initialEspnEventId?.trim();
    if (!id) {
      setEventPreview(null);
      return;
    }
    loadPreview(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEspnEventId, tournamentId]);

  async function saveEspnId() {
    setSaving(true);
    const { error } = await supabase
      .from("tournaments")
      .update({ espn_event_id: espnId.trim() || null } as any)
      .eq("id", tournamentId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("ESPN tournament ID saved");
    qc.invalidateQueries({ queryKey: ["admin-tournaments-list"] });
    qc.invalidateQueries({ queryKey: ["tournament", tournamentId] });
    onSaved?.();

    const saved = espnId.trim();
    if (saved) {
      loadPreview(saved);
    } else {
      setEventPreview(null);
    }
  }

  async function runImport() {
    if (!espnId.trim()) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await importFn({
        data: { tournament_id: tournamentId, espn_event_id: espnId.trim() },
      });
      setResult(res as any);
      if ((res as any)?.error) {
        toast.error((res as any).error);
      } else {
        toast.success(`Imported ${(res as any).imported} players`);
        // ESPN ingest writes tournament_leaderboard + recalculates tournament_scores;
        // refresh both so the leaderboard view updates without a page reload.
        qc.invalidateQueries({ queryKey: ["tournament-leaderboard", tournamentId] });
        qc.invalidateQueries({ queryKey: ["tournament-scores", tournamentId] });
        loadLeaderboardPreview();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
      setResult({ error: e?.message ?? "Import failed" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="border border-border bg-card p-4">
      <h2 className="font-display text-sm uppercase tracking-widest mb-3">
        ESPN Leaderboard Import
      </h2>
      <div className="space-y-3 max-w-xl">
        <Labeled label="ESPN tournament ID">
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={espnId}
              onChange={(e) => setEspnId(e.target.value)}
              placeholder="e.g. 401811947"
            />
            <button
              onClick={saveEspnId}
              disabled={saving}
              className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-border hover:bg-muted disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </Labeled>

        {loadingPreview && <p className="text-xs text-muted-foreground">Loading event info…</p>}
        {eventPreview && !loadingPreview && (
          <div className="border border-border bg-background p-3 text-xs">
            {eventPreview.error ? (
              <p className="text-destructive">{eventPreview.error}</p>
            ) : (
              <p className="font-semibold">{eventPreview.name}</p>
            )}
          </div>
        )}

        <button
          onClick={runImport}
          disabled={!espnId.trim() || importing}
          className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--forest-deep)" }}
        >
          {importing ? "Importing…" : "IMPORT ESPN DATA"}
        </button>

        <p className="text-[10px] text-muted-foreground">
          {lastImportedAt
            ? `Last imported: ${new Date(lastImportedAt).toLocaleString("en-GB")}`
            : "Not imported yet"}
        </p>

        {/* Tournament field preview — real golfers from ESPN, score-to-par.
            Not the Major7s team leaderboard; that's a different view
            elsewhere. Just a quick sanity check on what was just pulled. */}
        <div className="border border-border bg-background p-3 text-xs">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Tournament field — top 10
          </p>
          {loadingLeaderboardPreview ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : topGolfers.length === 0 ? (
            <p className="text-muted-foreground">No leaderboard data yet.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {topGolfers.map((g, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="py-1 pr-2 text-muted-foreground w-8">{g.position}</td>
                    <td className="py-1">{g.name}</td>
                    <td className="py-1 pl-2 text-right text-muted-foreground">{g.scoreToPar ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {result && (
          <div className="border border-border bg-background p-3 text-xs space-y-1">
            {result.error ? (
              <p className="text-destructive font-semibold">{result.error}</p>
            ) : (
              <>
                <p>
                  Imported <strong>{result.imported}</strong> · matched{" "}
                  <strong>{result.matched}</strong> · unmatched <strong>{result.unmatched}</strong>
                </p>
                {result.unmatched_names && result.unmatched_names.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
                      Unmatched golfers
                    </p>
                    <ul className="list-disc pl-5">
                      {result.unmatched_names.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
