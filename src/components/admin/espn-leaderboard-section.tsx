import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { importEspnLeaderboard } from "@/lib/espn-leaderboard.functions";

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

  const importFn = useServerFn(importEspnLeaderboard);

  useEffect(() => {
    setEspnId(initialEspnEventId ?? "");
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
    onSaved?.();
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
      if ((res as any)?.error) toast.error((res as any).error);
      else toast.success(`Imported ${(res as any).imported} players`);
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
        ESPN Final Leaderboard Import
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
        <button
          onClick={runImport}
          disabled={!espnId.trim() || importing}
          className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--forest-deep)" }}
        >
          {importing ? "Importing…" : "Import final leaderboard now"}
        </button>

        {result && (
          <div className="border border-border bg-background p-3 text-xs space-y-1">
            {result.error ? (
              <p className="text-destructive font-semibold">{result.error}</p>
            ) : (
              <>
                <p>
                  Imported <strong>{result.imported}</strong> · matched{" "}
                  <strong>{result.matched}</strong> · unmatched{" "}
                  <strong>{result.unmatched}</strong>
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
