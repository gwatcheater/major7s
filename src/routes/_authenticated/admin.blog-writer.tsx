import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  PenLine,
  Clock,
  Repeat,
  Trophy,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildStatsPack } from "@/lib/stats/buildStatsPack";
import type { Golfer, Pick, Team } from "@/lib/stats/types";
import { generateReport } from "@/lib/generate-report.functions";
import { generateFinalReport } from "@/lib/generate-final-report.functions";
import { generateRoundReport } from "@/lib/generate-round-report.functions";

// Gate is inherited from the parent admin.tsx beforeLoad. No new auth here.
export const Route = createFileRoute("/_authenticated/admin/blog-writer")({
  component: BlogWriterPage,
});

const REPORTS = [
  { key: "picks_closed", label: "Picks Closed" },
  { key: "r1", label: "R1" },
  { key: "r2", label: "R2" },
  { key: "r3", label: "R3" },
  { key: "final", label: "Final" },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

/** Supabase silently caps at 1,000 rows. Page exhaustively or the stats lie. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function fmt(iso: string | number | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BlogWriterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tournamentId, setTournamentId] = useState<string>("");
  const [reportType, setReportType] = useState<ReportKey>("picks_closed");
  const [colourNotes, setColourNotes] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<"markdown" | "preview">("markdown");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const callGenerate = useServerFn(generateReport);
  const callGenerateFinal = useServerFn(generateFinalReport);
  const callGenerateRound = useServerFn(generateRoundReport);

  // ---- tournaments that actually have picks --------------------------
  const tournamentsQ = useQuery({
    queryKey: ["bw", "tournaments"],
    queryFn: async () => {
      const { data: tours, error } = await supabase
        .from("tournaments")
        .select("id, name, location, start_date, status, submission_deadline")
        .order("start_date", { ascending: false });
      if (error) throw error;

      const withPicks: typeof tours = [];
      for (const t of tours ?? []) {
        const { count } = await supabase
          .from("picks")
          .select("*", { count: "exact", head: true })
          .eq("tournament_id", t.id);
        if ((count ?? 0) > 0) withPicks.push(t);
      }
      return withPicks;
    },
  });

  const tournaments = tournamentsQ.data ?? [];
  const selected = useMemo(() => {
    if (tournamentId) return tournaments.find((t) => t.id === tournamentId) ?? null;
    return (
      tournaments.find((t) => ["live", "picks_closed", "open_for_picks"].includes(t.status)) ??
      tournaments[0] ??
      null
    );
  }, [tournaments, tournamentId]);

  const activeId = selected?.id ?? "";

  // ---- stats preview -------------------------------------------------
  const statsQ = useQuery({
    queryKey: ["bw", "stats", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const picks = await fetchAll<Pick>((from, to) =>
        supabase
          .from("picks")
          .select("team_id, bucket, golfer_id, submitted_at, last_edited_at, tweak_count")
          .eq("tournament_id", activeId)
          .range(from, to),
      );
      const golfers = await fetchAll<Golfer>((from, to) =>
        supabase
          .from("golfers")
          .select("id, golfer_name, owgr_rank, bucket_number")
          .eq("tournament_id", activeId)
          .range(from, to),
      );
      const teamIds = Array.from(new Set(picks.map((p) => p.team_id)));
      const teams: Team[] = [];
      for (let i = 0; i < teamIds.length; i += 200) {
        const { data, error } = await supabase
          .from("teams")
          .select("id, nickname")
          .in("id", teamIds.slice(i, i + 200));
        if (error) throw error;
        teams.push(...((data ?? []) as Team[]));
      }
      return buildStatsPack(picks, golfers, teams);
    },
  });

  const contextQ = useQuery({
    queryKey: ["bw", "context", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("major7s_report_context", {
        p_tournament_id: activeId,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const pack = statsQ.data;
  const ctx = contextQ.data;

  // Max rounds completed across the field: gates the Final report (needs R4).
  const roundsQ = useQuery({
    queryKey: ["bw", "rounds", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournament_leaderboard")
        .select("rounds_completed")
        .eq("tournament_id", activeId)
        .order("rounds_completed", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.rounds_completed ?? 0;
    },
  });
  const roundsCompleted = roundsQ.data ?? 0;

  const deadlinePassed = selected?.submission_deadline
    ? new Date(selected.submission_deadline).getTime() < Date.now()
    : true;
  const picksClosedBlocked = reportType === "picks_closed" && !deadlinePassed;
  const finalBlocked = reportType === "final" && roundsCompleted < 4;
  // A round report needs that round scored: r1 -> 1, r2 -> 2, r3 -> 3.
  const roundNeeded = reportType === "r1" ? 1 : reportType === "r2" ? 2 : reportType === "r3" ? 3 : 0;
  const roundBlocked = roundNeeded > 0 && roundsCompleted < roundNeeded;
  const generateBlocked = picksClosedBlocked || finalBlocked || roundBlocked;

  const isRound = reportType === "r1" || reportType === "r2" || reportType === "r3";

  async function onGenerate() {
    if (!activeId) return;
    if (body.trim() && !confirm("This will overwrite the current draft. Continue?")) return;
    setGenerating(true);
    try {
      const res = isRound
        ? await callGenerateRound({
            data: { tournamentId: activeId, round: reportType as "r1" | "r2" | "r3", colourNotes },
          })
        : reportType === "final"
          ? await callGenerateFinal({ data: { tournamentId: activeId, colourNotes } })
          : await callGenerate({ data: { tournamentId: activeId, reportType, colourNotes } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTitle(res.title);
      setBody(res.body);
      setTab("markdown");
      toast.success("Draft generated. Review before publishing.");
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function onPublish() {
    if (!user || !selected) return;
    if (!title.trim()) {
      toast.error("Enter a title");
      return;
    }
    setPublishing(true);
    const { error } = await supabase.from("blog_posts").insert({
      author_id: user.id,
      tournament_id: selected.id,
      title: title.trim(),
      body: body.trim(),
      image_url: null,
    });
    setPublishing(false);
    if (error) {
      toast.error(`Could not publish: ${error.message}`);
      return;
    }
    toast.success("Blog post published");
    navigate({ to: "/tournament/$id", params: { id: selected.id } });
  }

  const headline = pack
    ? {
        entries: pack.entryCount,
        untouched: pack.fieldSize - pack.distinctPicked,
        top: pack.mostPopular[0],
      }
    : null;

  return (
    <div className="mt-16 max-w-5xl mx-auto px-4 pb-20">
      <div className="pt-4">
        <Link
          to="/admin"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Admin
        </Link>
        <header className="mt-4 mb-6">
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--gold)" }}
          >
            Admin Only
          </p>
          <h1 className="font-display text-3xl md:text-4xl uppercase mt-1 flex items-center gap-3">
            <PenLine className="w-7 h-7" style={{ color: "var(--gold)" }} />
            Blog Writer
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Generates the post from pick data. You add the colour and publish.
          </p>
        </header>
      </div>

      {/* 1 SOURCE */}
      <Card className="p-5 mb-4">
        <StepHead n="1" title="Source" />
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">
              Tournament
            </label>
            <select
              value={activeId}
              onChange={(e) => setTournamentId(e.target.value)}
              className="w-full px-3 py-2.5 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {new Date(t.start_date).getFullYear()} · {t.status}
                </option>
              ))}
            </select>
            {selected?.location && (
              <p className="text-xs text-muted-foreground mt-1.5">{selected.location}</p>
            )}
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">
              Report
            </label>
            <div className="flex flex-wrap gap-1.5">
              {REPORTS.map((r) => {
                // picks_closed always available. r1/r2/r3 unlock once that round
                // is scored; final unlocks once all four rounds are in.
                const needed =
                  r.key === "r1" ? 1 : r.key === "r2" ? 2 : r.key === "r3" ? 3 : r.key === "final" ? 4 : 0;
                const locked = r.key === "picks_closed" ? false : roundsCompleted < needed;
                return (
                  <button
                    key={r.key}
                    disabled={locked}
                    onClick={() => setReportType(r.key)}
                    className={`px-3 py-2 rounded-sm text-xs font-bold transition-colors border ${
                      reportType === r.key
                        ? "text-white border-transparent"
                        : locked
                          ? "opacity-35 cursor-not-allowed border-input"
                          : "border-input text-muted-foreground hover:text-foreground"
                    }`}
                    style={
                      reportType === r.key ? { backgroundColor: "var(--forest-deep)" } : undefined
                    }
                  >
                    {r.label}
                    {locked && <span className="block text-[9px] font-normal">locked</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* 2 NUMBERS */}
      <Card className="p-5 mb-4">
        <StepHead n="2" title="The numbers" note="computed from picks · nothing invented" />
        {statsQ.isLoading || contextQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Crunching…</p>
        ) : !pack ? (
          <p className="text-sm text-muted-foreground">No picks for this tournament.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              <Fact label="Entries" value={String(headline!.entries)} gold />
              <Fact
                label={headline!.top ? `Picked ${headline!.top.name.split(" ").pop()}` : "Top pick"}
                value={headline!.top ? String(headline!.top.count) : "—"}
              />
              <Fact
                label="Field picked"
                value={`${pack.distinctPicked}/${pack.fieldSize}`}
              />
              <Fact label="No backer" value={String(headline!.untouched)} red />
              <Fact label="Unique picks" value={String(pack.uniqueTotal)} />
            </div>

            {ctx && !ctx.error && (
              <div className="border-t pt-4">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Trophy className="w-3 h-3" /> Records
                  <span className="font-normal normal-case tracking-normal opacity-70">
                    {ctx.data_range?.first_year}–{ctx.data_range?.last_year} ·{" "}
                    {ctx.data_range?.events_with_data} events with data
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                  <Rec
                    label={`What wins ${ctx.family ?? ""}`}
                    value={ctx.family_avg_winning_score ?? "—"}
                    sub="average winning score"
                  />
                  <Rec
                    label="Last winner"
                    value={ctx.last_family_winner?.points ?? "—"}
                    sub={`${ctx.last_family_winner?.team ?? "—"} · ${ctx.last_family_winner?.year ?? ""}`}
                  />
                  <Rec
                    label="All-time best"
                    value={ctx.all_time_best?.points ?? "—"}
                    sub={`${ctx.all_time_best?.team ?? "—"} · ${ctx.all_time_best?.tournament_name ?? ""} ${ctx.all_time_best?.year ?? ""}`}
                    gold
                  />
                  <Rec
                    label="All-time worst"
                    value={ctx.all_time_worst?.points ?? "—"}
                    sub={`${ctx.all_time_worst?.team ?? "—"} · ${ctx.all_time_worst?.tournament_name ?? ""} ${ctx.all_time_worst?.year ?? ""}`}
                    red
                  />
                </div>

                {Array.isArray(ctx.debutants) && ctx.debutants.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5">
                      Debutants · {ctx.debutant_count}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {ctx.debutants.map((d: any) => (
                        <span
                          key={d.team_id}
                          className="text-[11px] px-2 py-0.5 rounded-full border font-semibold"
                          style={{
                            color: "var(--gold)",
                            borderColor: "var(--gold)",
                            backgroundColor: "rgba(212,175,55,.08)",
                          }}
                        >
                          {d.nickname}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border-t pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Fun
                icon={Clock}
                label="Quickest entry"
                value={pack.timings.first ? pack.teamNames[pack.timings.first.teamId] : "—"}
                sub={fmt(pack.timings.first?.submitted ?? null)}
              />
              <Fun
                icon={Clock}
                label="Last in"
                value={pack.timings.last ? pack.teamNames[pack.timings.last.teamId] : "—"}
                sub={fmt(pack.timings.last?.submitted ?? null)}
              />
              <Fun
                icon={Repeat}
                label="Most tweaks"
                value={
                  pack.timings.tweakers[0]
                    ? `${pack.teamNames[pack.timings.tweakers[0].teamId]} · ${pack.timings.tweakers[0].tweaks}`
                    : "—"
                }
                sub={`${pack.timings.untouched} of ${pack.timings.total} never changed`}
              />
              <Fun
                icon={PenLine}
                label="Last to change"
                value={
                  pack.timings.editors[0] ? pack.teamNames[pack.timings.editors[0].teamId] : "—"
                }
                sub={fmt(pack.timings.editors[0]?.edited ?? null)}
              />
            </div>
          </>
        )}
      </Card>

      {/* 3 COLOUR */}
      <Card className="p-5 mb-4">
        <StepHead
          n="3"
          title="Colour from the day"
          note="the only thing the database cannot know"
        />
        <textarea
          value={colourNotes}
          onChange={(e) => setColourNotes(e.target.value)}
          rows={3}
          placeholder="Weather, course conditions, form, backstories, grudges…"
          className="w-full px-3 py-2.5 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary resize-y"
        />
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <Button onClick={onGenerate} disabled={generating || !activeId || generateBlocked}>
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Generate post
          </Button>
          {activeId && (
            <Link
              to="/tournament/$id/stats"
              params={{ id: activeId }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              View stats page
            </Link>
          )}
          {picksClosedBlocked && (
            <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--alert)" }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Picks close {fmt(selected?.submission_deadline ?? null)} · numbers will still move
            </span>
          )}
          {finalBlocked && (
            <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--alert)" }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Final needs all four rounds scored · currently {roundsCompleted} complete
            </span>
          )}
          {roundBlocked && (
            <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--alert)" }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Round {roundNeeded} not scored yet · currently {roundsCompleted} complete · import the leaderboard
            </span>
          )}
        </div>
      </Card>

      {/* 4 DRAFT */}
      {(title || body) && (
        <Card className="p-5">
          <StepHead n="4" title="Draft" note="edit freely before publishing" />
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">
            Title
          </label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className="flex gap-1 mt-4 mb-2 border-b">
            {(["markdown", "preview"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs font-bold px-3 py-1.5 border-b-2 -mb-px capitalize ${
                  tab === t
                    ? "border-current"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                style={tab === t ? { color: "var(--forest-deep)" } : undefined}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "markdown" ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={22}
              className="w-full px-3 py-2.5 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary resize-y font-mono text-[12.5px] leading-relaxed"
            />
          ) : (
            // Same renderer config as blog-post-content.tsx so what you see here
            // is exactly what publishes. No rehype-raw: HTML and SVG are stripped.
            <div className="border border-input rounded-sm p-5 bg-white max-h-[560px] overflow-auto">
              <div className="prose prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              </div>
            </div>
          )}

          <div
            className="mt-4 text-xs flex items-start gap-2 p-3 rounded-sm"
            style={{ backgroundColor: "rgba(212,175,55,.08)" }}
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--gold)" }} />
            <span>
              <b>No draft state exists.</b> blog_posts has no published flag, so this goes live to
              every signed-in user the moment you publish. This editor is the review step.
            </span>
          </div>

          <div className="flex gap-2 pt-4 flex-wrap">
            <Button onClick={onPublish} disabled={publishing || !title.trim() || !body.trim()}>
              {publishing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Publish to {selected?.name ?? "tournament"}
            </Button>
            <Button variant="outline" onClick={onGenerate} disabled={generating}>
              Regenerate
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function StepHead({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span
        className="grid place-items-center h-5 w-5 rounded-sm text-[10px] font-black text-white"
        style={{ backgroundColor: "var(--forest-deep)" }}
      >
        {n}
      </span>
      <h2 className="text-[11px] uppercase tracking-widest font-bold">{title}</h2>
      {note && <span className="text-[10px] text-muted-foreground ml-auto">{note}</span>}
    </div>
  );
}

function Fact({
  label,
  value,
  gold,
  red,
}: {
  label: string;
  value: string;
  gold?: boolean;
  red?: boolean;
}) {
  return (
    <div className="border rounded-sm p-2.5 bg-muted/30">
      <div
        className="text-lg font-extrabold tracking-tight leading-none"
        style={gold ? { color: "var(--gold)" } : red ? { color: "var(--alert)" } : undefined}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1 font-bold leading-tight">
        {label}
      </div>
    </div>
  );
}

function Rec({
  label,
  value,
  sub,
  gold,
  red,
}: {
  label: string;
  value: string | number;
  sub: string;
  gold?: boolean;
  red?: boolean;
}) {
  return (
    <div className="border rounded-sm p-2.5 bg-muted/30">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
        {label}
      </div>
      <div
        className="text-lg font-extrabold tracking-tight leading-none"
        style={gold ? { color: "var(--gold)" } : red ? { color: "var(--alert)" } : undefined}
      >
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{sub}</div>
    </div>
  );
}

function Fun({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold mb-1 flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-sm font-extrabold tracking-tight">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
