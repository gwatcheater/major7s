import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, XCircle, Loader2, Download } from "lucide-react";

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const REQUIRED_HEADERS = ["team_nickname", "B1", "B2", "B3", "B4", "B5", "B6", "B7"] as const;

type RowResult = {
  line: number;
  raw: Record<string, string>;
  nickname: string;
  picks: Array<{ bucket: number; name: string }>;
  errors: string[];
  warnings: string[];
  teamId?: string;
  ownerUserId?: string;
  resolved?: Array<{ bucket: number; golferId: string }>;
  hadExistingPicks?: boolean;
};

function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (l: string) => l.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  const headers = split(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const parts = split(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = parts[i] ?? ""));
    return obj;
  });
  return { headers, rows };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function BulkPickUpload({ tournamentId }: { tournamentId: string | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [lastLog, setLastLog] = useState<null | {
    committed: number;
    skipped: number;
    overwritten: number;
    details: Array<{ line: number; team: string; status: "ok" | "overwritten" | "skipped" | "error"; reason?: string }>;
  }>(null);

  const { data: golfers = [] } = useQuery({
    queryKey: ["admin-bulk-pick-golfers", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("golfers")
        .select("id, golfer_name, bucket_number")
        .eq("tournament_id", tournamentId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: teamCtx } = useQuery({
    queryKey: ["admin-bulk-pick-teams-ctx", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const { data: teams, error: tErr } = await supabase
        .from("teams")
        .select("id, owner_user_id, nickname, is_primary");
      if (tErr) throw tErr;
      const ownerIds = Array.from(new Set((teams ?? []).map((t) => t.owner_user_id)));
      const { data: profs, error: pErr } =
        ownerIds.length === 0
          ? { data: [], error: null }
          : await supabase.from("profiles").select("id, status").in("id", ownerIds);
      if (pErr) throw pErr;
      const statusByUser = new Map<string, string>();
      for (const p of profs ?? []) statusByUser.set(p.id, p.status);
      const existingTeamIds: string[] = [];
      {
        const PAGE_SIZE = 1000;
        let from = 0;
        while (true) {
          const { data: page, error: eErr } = await supabase
            .from("picks")
            .select("team_id")
            .eq("tournament_id", tournamentId!)
            .range(from, from + PAGE_SIZE - 1);
          if (eErr) throw eErr;
          const rows = page ?? [];
          existingTeamIds.push(...rows.map((p) => p.team_id));
          if (rows.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
      }
      const teamsWithPicks = new Set(existingTeamIds);
      return { teams: teams ?? [], statusByUser, teamsWithPicks };
    },
  });

  const parsed = useMemo(() => parseCsv(csvText), [csvText]);

  const headerError = useMemo(() => {
    if (!csvText) return null;
    const missing = REQUIRED_HEADERS.filter((h) => !parsed.headers.includes(h));
    if (missing.length > 0) return `Missing required columns: ${missing.join(", ")}`;
    return null;
  }, [csvText, parsed.headers]);

  const golferByName = useMemo(() => {
    const m = new Map<string, { id: string; bucket: number }>();
    for (const g of golfers) m.set(normalize(g.golfer_name), { id: g.id, bucket: g.bucket_number });
    return m;
  }, [golfers]);

  const teamsByNickname = useMemo(() => {
    const m = new Map<string, Array<{ id: string; owner_user_id: string; is_primary: boolean }>>();
    if (!teamCtx) return m;
    for (const t of teamCtx.teams) {
      const k = normalize(t.nickname);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [teamCtx]);

  const rowResults: RowResult[] = useMemo(() => {
    if (!csvText || headerError) return [];
    const seenNicks = new Map<string, number>();
    return parsed.rows.map((raw, idx) => {
      const line = idx + 2;
      const nickname = (raw.team_nickname || "").trim();
      const picks = BUCKETS.map((b) => ({ bucket: b, name: (raw[`B${b}`] || "").trim() }));
      const errors: string[] = [];
      const warnings: string[] = [];
      let teamId: string | undefined;
      let ownerUserId: string | undefined;
      let hadExistingPicks = false;
      const resolved: Array<{ bucket: number; golferId: string }> = [];

      if (!nickname) {
        errors.push("Missing team_nickname");
      } else if (teamCtx) {
        const key = normalize(nickname);
        const prevLine = seenNicks.get(key);
        if (prevLine) errors.push(`Duplicate team_nickname in CSV (also line ${prevLine})`);
        else seenNicks.set(key, line);

        const matches = teamsByNickname.get(key) ?? [];
        if (matches.length === 0) {
          errors.push(`Team nickname '${nickname}' not found`);
        } else {
          const eligible = matches.filter(
            (t) => teamCtx.statusByUser.get(t.owner_user_id) === "approved",
          );
          if (eligible.length === 0) {
            errors.push(`Team '${nickname}' has no approved owner`);
          } else if (eligible.length > 1) {
            errors.push(
              `Team nickname '${nickname}' is ambiguous (${eligible.length} matches across users)`,
            );
          } else {
            teamId = eligible[0].id;
            ownerUserId = eligible[0].owner_user_id;
            if (teamCtx.teamsWithPicks.has(teamId)) {
              hadExistingPicks = true;
              if (!overwriteExisting) {
                errors.push("Picks already submitted for this team (enable Overwrite to replace)");
              } else {
                warnings.push("Existing picks will be replaced");
              }
            }
          }
        }
      }

      const seenBuckets = new Set<number>();
      for (const p of picks) {
        if (!p.name) {
          errors.push(`Missing pick for B${p.bucket}`);
          continue;
        }
        const g = golferByName.get(normalize(p.name));
        if (!g) {
          errors.push(`Golfer '${p.name}' not in field (B${p.bucket})`);
        } else if (g.bucket !== p.bucket) {
          errors.push(`'${p.name}' belongs to bucket B${g.bucket}, not B${p.bucket}`);
        } else if (seenBuckets.has(p.bucket)) {
          errors.push(`Duplicate bucket B${p.bucket}`);
        } else {
          seenBuckets.add(p.bucket);
          resolved.push({ bucket: p.bucket, golferId: g.id });
        }
      }

      return { line, raw, nickname, picks, errors, warnings, teamId, ownerUserId, resolved, hadExistingPicks };
    });
  }, [csvText, headerError, parsed.rows, teamCtx, teamsByNickname, golferByName, overwriteExisting]);

  const validRows = rowResults.filter((r) => r.errors.length === 0);
  const errorCount = rowResults.length - validRows.length;
  const canCommit = !!tournamentId && !headerError && validRows.length > 0 && !committing;

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  async function commit() {
    if (!canCommit || !tournamentId) return;
    setCommitting(true);
    const details: Array<{ line: number; team: string; status: "ok" | "overwritten" | "skipped" | "error"; reason?: string }> = [];
    let committed = 0;
    let overwritten = 0;

    try {
      // Process each valid row independently so a single failure doesn't abort the batch.
      for (const r of validRows) {
        if (!r.teamId || !r.resolved) continue;
        try {
          if (r.hadExistingPicks) {
            const { error: delErr } = await supabase
              .from("picks")
              .delete()
              .eq("tournament_id", tournamentId)
              .eq("team_id", r.teamId);
            if (delErr) throw delErr;
          }
          const payload = r.resolved.map((p) => ({
            tournament_id: tournamentId,
            team_id: r.teamId!,
            golfer_id: p.golferId,
            bucket: p.bucket,
          }));
          const { error: insErr } = await supabase.from("picks").insert(payload);
          if (insErr) throw insErr;

          if (r.hadExistingPicks) {
            overwritten += 1;
            details.push({ line: r.line, team: r.nickname, status: "overwritten" });
          } else {
            committed += 1;
            details.push({ line: r.line, team: r.nickname, status: "ok" });
          }

          // Per-row admin audit (after-lock flag = false for bulk; logs already exist for individual edits)
          if (r.ownerUserId) {
            await supabase.rpc("audit_admin_pick_edit", {
              _target: r.ownerUserId,
              _tournament: tournamentId,
              _after_lock: false,
            });
          }
        } catch (e: any) {
          details.push({ line: r.line, team: r.nickname, status: "error", reason: e?.message ?? "insert failed" });
        }
      }

      // Skipped = rows that had errors and were never attempted
      for (const r of rowResults) {
        if (r.errors.length > 0) {
          details.push({ line: r.line, team: r.nickname || "—", status: "skipped", reason: r.errors[0] });
        }
      }

      const skipped = errorCount;
      setLastLog({ committed, overwritten, skipped, details });

      // Batch-level audit entry capturing the validation log summary
      try {
        await supabase.from("admin_audit").insert({
          actor_id: user?.id ?? null,
          action: "picks.bulk_upload",
          target_user: null,
          detail: {
            tournament_id: tournamentId,
            committed,
            overwritten,
            skipped,
            total_rows: rowResults.length,
            overwrite_mode: overwriteExisting,
            results: details,
          },
        });
      } catch {
        // non-fatal
      }

      if (committed + overwritten > 0) {
        toast.success(`Uploaded ${committed} new, ${overwritten} replaced, ${skipped} skipped`);
      } else if (skipped > 0) {
        toast.error(`No rows committed — ${skipped} skipped`);
      }

      qc.invalidateQueries({ queryKey: ["admin-picks-for-tournament", tournamentId] });
      qc.invalidateQueries({ queryKey: ["admin-bulk-pick-teams-ctx", tournamentId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setCommitting(false);
    }
  }

  function downloadLog() {
    if (!lastLog) return;
    const header = "line,team,status,reason\n";
    const body = lastLog.details
      .map((d) => `${d.line},"${(d.team ?? "").replace(/"/g, '""')}",${d.status},"${(d.reason ?? "").replace(/"/g, '""')}"`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-picks-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="size-4" />
          Bulk Picks Upload (CSV)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!tournamentId && (
          <Alert variant="destructive">
            <AlertDescription>Select a tournament above to enable bulk pick upload.</AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertTitle className="text-xs uppercase tracking-widest">Format</AlertTitle>
          <AlertDescription className="text-xs font-mono">
            {REQUIRED_HEADERS.join(", ")}
            <p className="text-xs mt-1 font-sans text-muted-foreground">
              Identify each entry by the team's nickname (primary or additional). Golfer names must
              match field exactly (case-insensitive) and be in the listed bucket.
            </p>
          </AlertDescription>
        </Alert>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
            dragActive ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40"
          }`}
        >
          <FileText className="size-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">
            {fileName ? fileName : "Drop CSV here or click to browse"}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={overwriteExisting}
            onChange={(e) => setOverwriteExisting(e.target.checked)}
          />
          Overwrite teams that already have picks for this tournament
        </label>

        {headerError && (
          <Alert variant="destructive">
            <AlertTitle>Invalid CSV headers</AlertTitle>
            <AlertDescription>{headerError}</AlertDescription>
          </Alert>
        )}

        {rowResults.length > 0 && !headerError && (
          <>
            <div className="text-xs font-mono flex gap-3">
              <span className="text-emerald-600">{validRows.length} valid</span>
              <span className="text-destructive">{errorCount} errors</span>
              <span className="text-muted-foreground">{rowResults.length} total</span>
            </div>

            <div className="max-h-[360px] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Team</th>
                    {BUCKETS.map((b) => (
                      <th key={b} className="text-left p-2">
                        B{b}
                      </th>
                    ))}
                    <th className="text-left p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rowResults.flatMap((r) => {
                    const bad = r.errors.length > 0;
                    const warn = !bad && r.warnings.length > 0;
                    const rows = [
                      <tr
                        key={`row-${r.line}`}
                        className={
                          bad
                            ? "bg-destructive/5 border-t border-destructive/20"
                            : warn
                              ? "bg-amber-500/5 border-t border-amber-500/20"
                              : "bg-emerald-500/5 border-t border-emerald-500/20"
                        }
                      >
                        <td className="p-2 font-mono text-muted-foreground">{r.line}</td>
                        <td className="p-2">{r.raw.team_nickname || "—"}</td>
                        {r.picks.map((p) => (
                          <td key={p.bucket} className="p-2">
                            {p.name || <span className="text-destructive">—</span>}
                          </td>
                        ))}
                        <td className="p-2">
                          {bad ? (
                            <XCircle className="size-4 text-destructive" />
                          ) : (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          )}
                        </td>
                      </tr>,
                    ];
                    if (bad || warn) {
                      rows.push(
                        <tr key={`msg-${r.line}`} className={bad ? "bg-destructive/5" : "bg-amber-500/5"}>
                          <td colSpan={10} className={`px-2 pb-2 ${bad ? "text-destructive" : "text-amber-700"}`}>
                            {(bad ? r.errors : r.warnings).join(" · ")}
                          </td>
                        </tr>,
                      );
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={commit} disabled={!canCommit} className="gap-2">
            {committing && <Loader2 className="size-4 animate-spin" />}
            Commit {validRows.length} Valid Row{validRows.length === 1 ? "" : "s"}
          </Button>
          {lastLog && (
            <Button variant="outline" onClick={downloadLog} className="gap-2">
              <Download className="size-4" />
              Download Validation Log
            </Button>
          )}
        </div>

        {lastLog && (
          <div className="border rounded-md p-3 text-xs space-y-1 max-h-64 overflow-y-auto">
            <div className="font-bold">
              Result: {lastLog.committed} committed · {lastLog.overwritten} overwritten ·{" "}
              {lastLog.skipped} skipped
            </div>
            {lastLog.details.map((d, i) => (
              <div
                key={i}
                className={
                  d.status === "error" || d.status === "skipped"
                    ? "text-destructive"
                    : d.status === "overwritten"
                      ? "text-amber-600"
                      : "text-emerald-600"
                }
              >
                line {d.line} · {d.team} · {d.status}
                {d.reason ? ` — ${d.reason}` : ""}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
