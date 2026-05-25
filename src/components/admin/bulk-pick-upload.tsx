import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const REQUIRED_HEADERS = ["user_email", "B1", "B2", "B3", "B4", "B5", "B6", "B7"] as const;

type RowResult = {
  line: number;
  raw: Record<string, string>;
  email: string;
  picks: Array<{ bucket: number; name: string }>;
  errors: string[];
  teamId?: string;
  resolved?: Array<{ bucket: number; golferId: string }>;
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

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function BulkPickUpload({ tournamentId }: { tournamentId: string | null }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

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

  const parsed = useMemo(() => parseCsv(csvText), [csvText]);

  const headerError = useMemo(() => {
    if (!csvText) return null;
    const missing = REQUIRED_HEADERS.filter((h) => !parsed.headers.includes(h));
    if (missing.length > 0) return `Missing required columns: ${missing.join(", ")}`;
    return null;
  }, [csvText, parsed.headers]);

  const emailList = useMemo(
    () =>
      Array.from(
        new Set(parsed.rows.map((r) => (r.user_email || "").toLowerCase().trim()).filter(Boolean)),
      ),
    [parsed.rows],
  );

  const { data: lookup } = useQuery({
    queryKey: ["admin-bulk-pick-lookup", tournamentId, emailList.join("|")],
    enabled: !!tournamentId && emailList.length > 0 && !headerError,
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, status")
        .in("email", emailList);
      if (pErr) throw pErr;
      const userIds = (profiles ?? []).map((p) => p.id);
      const { data: teams, error: tErr } =
        userIds.length === 0
          ? { data: [], error: null }
          : await supabase
              .from("teams")
              .select("id, owner_user_id, is_primary")
              .in("owner_user_id", userIds);
      if (tErr) throw tErr;
      const profileByEmail = new Map<string, { id: string; status: string }>();
      for (const p of profiles ?? []) {
        if (p.email) profileByEmail.set(p.email.toLowerCase(), { id: p.id, status: p.status });
      }
      const teamByUser = new Map<string, string>();
      for (const t of teams ?? []) {
        if (!teamByUser.has(t.owner_user_id) || t.is_primary)
          teamByUser.set(t.owner_user_id, t.id);
      }
      return { profileByEmail, teamByUser };
    },
  });

  const golferByName = useMemo(() => {
    const m = new Map<string, { id: string; bucket: number }>();
    for (const g of golfers) m.set(normalizeName(g.golfer_name), { id: g.id, bucket: g.bucket_number });
    return m;
  }, [golfers]);

  const rowResults: RowResult[] = useMemo(() => {
    if (!csvText || headerError) return [];
    return parsed.rows.map((raw, idx) => {
      const line = idx + 2;
      const email = (raw.user_email || "").toLowerCase().trim();
      const picks = BUCKETS.map((b) => ({ bucket: b, name: (raw[`B${b}`] || "").trim() }));
      const errors: string[] = [];
      let teamId: string | undefined;
      const resolved: Array<{ bucket: number; golferId: string }> = [];

      if (!email) {
        errors.push("Missing user_email");
      } else if (lookup) {
        const prof = lookup.profileByEmail.get(email);
        if (!prof) errors.push(`Email '${raw.user_email}' not found`);
        else if (prof.status !== "approved") errors.push(`Email '${raw.user_email}' is not active`);
        else {
          const t = lookup.teamByUser.get(prof.id);
          if (!t) errors.push(`No team found for '${raw.user_email}'`);
          else teamId = t;
        }
      }

      for (const p of picks) {
        if (!p.name) {
          errors.push(`Missing pick for bucket B${p.bucket}`);
          continue;
        }
        const g = golferByName.get(normalizeName(p.name));
        if (!g) errors.push(`Golfer '${p.name}' not found in field (B${p.bucket})`);
        else resolved.push({ bucket: p.bucket, golferId: g.id });
      }

      return { line, raw, email, picks, errors, teamId, resolved };
    });
  }, [csvText, headerError, parsed.rows, lookup, golferByName]);

  const validCount = rowResults.filter((r) => r.errors.length === 0).length;
  const errorCount = rowResults.filter((r) => r.errors.length > 0).length;
  const canCommit =
    !!tournamentId &&
    !headerError &&
    rowResults.length > 0 &&
    errorCount === 0 &&
    !committing;

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
    try {
      const teamIds = Array.from(
        new Set(rowResults.map((r) => r.teamId).filter((x): x is string => !!x)),
      );
      const { error: delErr } = await supabase
        .from("picks")
        .delete()
        .eq("tournament_id", tournamentId)
        .in("team_id", teamIds);
      if (delErr) throw delErr;

      const payload = rowResults.flatMap((r) =>
        (r.resolved ?? []).map((p) => ({
          tournament_id: tournamentId,
          team_id: r.teamId!,
          golfer_id: p.golferId,
          bucket: p.bucket,
        })),
      );
      const { error: insErr } = await supabase.from("picks").insert(payload);
      if (insErr) throw insErr;

      toast.success(
        `Uploaded ${rowResults.length} entr${rowResults.length === 1 ? "y" : "ies"} (${payload.length} picks)`,
      );
      setCsvText("");
      setFileName(null);
      qc.invalidateQueries({ queryKey: ["admin-picks-for-tournament", tournamentId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="size-4" />
          Bulk CSV Pick Upload
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!tournamentId && (
          <Alert variant="destructive">
            <AlertDescription>Select a tournament above to enable bulk pick upload.</AlertDescription>
          </Alert>
        )}

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
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Required headers: {REQUIRED_HEADERS.join(", ")}
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

        {headerError && (
          <Alert variant="destructive">
            <AlertTitle>Invalid CSV headers</AlertTitle>
            <AlertDescription>{headerError}</AlertDescription>
          </Alert>
        )}

        {rowResults.length > 0 && !headerError && (
          <>
            <div className="text-xs font-mono flex gap-3">
              <span className="text-emerald-600">{validCount} valid</span>
              <span className="text-destructive">{errorCount} errors</span>
              <span className="text-muted-foreground">{rowResults.length} total</span>
            </div>

            <div className="max-h-[360px] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Email</th>
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
                    const rows = [
                      <tr
                        key={`row-${r.line}`}
                        className={
                          bad
                            ? "bg-destructive/5 border-t border-destructive/20"
                            : "bg-emerald-500/5 border-t border-emerald-500/20"
                        }
                      >
                        <td className="p-2 font-mono text-muted-foreground">{r.line}</td>
                        <td className="p-2">{r.raw.user_email || "—"}</td>
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
                    if (bad) {
                      rows.push(
                        <tr key={`err-${r.line}`} className="bg-destructive/5">
                          <td colSpan={10} className="px-2 pb-2 text-destructive">
                            {r.errors.join(" · ")}
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

        <Button onClick={commit} disabled={!canCommit} className="gap-2">
          {committing && <Loader2 className="size-4 animate-spin" />}
          Commit Bulk Upload
          {rowResults.length > 0 && errorCount === 0 ? ` (${rowResults.length})` : ""}
        </Button>
      </CardContent>
    </Card>
  );
}
