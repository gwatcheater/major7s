// =============================================================
// MajorsStatsTable.tsx
// Career major-championship performance (OWGR, 2000-present), backed by the
// golfer_major_stats RPC over owgr_event_results. Sits as a third tab on the
// stats page alongside Team Stats and Golfer Stats.
//
// Filter model: major + year range re-aggregate on the server (they change the
// numbers). Min-majors, search, nationality and sort are client-side on the
// returned set (instant). Styling mirrors GolferStatsView.
// =============================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import GolferHistoryPanel, { type GolferSummary } from "@/components/GolferHistoryPanel";

const MAJORS = ["Masters", "PGA", "US Open", "The Open"] as const;
const YEAR_MIN = 2000;
const YEAR_MAX = new Date().getFullYear();

interface GolferMajorStat {
  owgr_player_id: number;
  player: string;
  country: string | null;
  majors_played: number;
  debut_year: number;
  last_year: number;
  cuts_made: number;
  cut_pct: number;
  wins: number;
  top10s: number;
  top10_pct: number;
  best_finish: number | null;
  avg_finish: number | null;
  best_seed: number | null;
  avg_seed: number | null;
  total_points: number;
}

type SortKey =
  | "player" | "majors_played" | "best_seed" | "avg_seed" | "cut_pct"
  | "wins" | "top10s" | "best_finish" | "avg_finish";

// server-side aggregate. p_min_majors=1: min-majors is applied client-side so
// its slider never refetches. Only major / year change the query key.
function useMajorStats(major: string | null, yearFrom: number, yearTo: number) {
  return useQuery({
    queryKey: ["golfer-major-stats", major, yearFrom, yearTo],
    queryFn: async (): Promise<GolferMajorStat[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("golfer_major_stats", {
        p_major: major ?? undefined,
        p_year_from: yearFrom,
        p_year_to: yearTo,
        p_min_majors: 1,
      });
      if (error) throw new Error(error.message);
      // avg_finish comes back as a numeric string from PostgREST — coerce it.
      return ((data ?? []) as GolferMajorStat[]).map((r) => ({
        ...r,
        avg_finish: r.avg_finish == null ? null : Number(r.avg_finish),
      }));
    },
  });
}

export default function MajorsStatsTable() {
  // server filters (re-aggregate)
  const [major, setMajor] = useState<string | null>(null);
  const [yearFrom, setYearFrom] = useState(YEAR_MIN);
  const [yearTo, setYearTo] = useState(YEAR_MAX);
  const { data = [], isLoading, error } = useMajorStats(major, yearFrom, yearTo);

  // client filters
  const [minMajors, setMinMajors] = useState(12);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("majors_played");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<GolferSummary | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = data.filter(
      (d) =>
        d.majors_played >= minMajors &&
        (!q || d.player.toLowerCase().includes(q)),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string") return dir * x.localeCompare(y as string);
      return dir * ((x as number) - (y as number));
    });
    return r;
  }, [data, minMajors, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "player" ? "asc" : "desc"); }
  }

  if (error) {
    return (
      <div className="text-center py-12 text-sm">
        <div className="text-red-600 font-semibold mb-2">Failed to load major stats</div>
        <div className="text-slate-500 text-xs font-mono">{(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Intro */}
      <div className="mb-4 text-xs text-slate-600 leading-relaxed">
        <p>
          Career performance across majors since 2000. <span className="font-semibold" style={{ color: "var(--forest-deep)" }}>OWGR</span> is the ranking a golfer entered a major with — best and average, unranked entries excluded. <span className="font-semibold" style={{ color: "var(--forest-deep)" }}>Avg Pos</span> counts made cuts only.
        </p>
      </div>

      {/* Filter row */}
      {/* Major chips */}
      <div className="mb-3">
        <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-slate-200 p-0.5">
          {([{ label: "All", value: null }, ...MAJORS.map((m) => ({ label: m, value: m as string | null }))]).map((c) => {
            const active = major === c.value;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => setMajor(c.value)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${
                  active ? "shadow-sm" : "text-slate-500 hover:text-[color:var(--forest-deep)]"
                }`}
                style={active ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Year range */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <FilterSelect label="From" value={String(yearFrom)} onChange={(v) => setYearFrom(Number(v))}>
          {years().map((y) => <option key={y} value={y}>{y}</option>)}
        </FilterSelect>
        <FilterSelect label="To" value={String(yearTo)} onChange={(v) => setYearTo(Number(v))}>
          {years().map((y) => <option key={y} value={y}>{y}</option>)}
        </FilterSelect>
      </div>

      {/* Min majors slider + count */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Min majors</label>
          <input type="range" min={1} max={80} step={1} value={minMajors}
            onChange={(e) => setMinMajors(Number(e.target.value))}
            className="w-32 accent-[color:var(--gold)]" />
          <span className="text-xs font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>{minMajors}</span>
        </div>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {isLoading ? "Loading…" : `${rows.length} golfer${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Search */}
      <div className="mb-3">
        <input type="text" placeholder="Search golfers…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-9 px-3 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]"
          style={{ color: "var(--forest-deep)" }} />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block border border-slate-200 rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
            <tr>
              <SortHeader label="Golfer" k="player" sk={sortKey} sd={sortDir} on={toggleSort} align="left" />
              <SortHeader label="Majors" k="majors_played" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="OWGR · best" k="best_seed" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="OWGR · avg" k="avg_seed" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="Cuts" k="cut_pct" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="Wins" k="wins" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="Top 10" k="top10s" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="Best" k="best_finish" sk={sortKey} sd={sortDir} on={toggleSort} align="center" />
              <SortHeader label="Avg Pos" k="avg_finish" sk={sortKey} sd={sortDir} on={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-6 text-slate-400 text-xs italic">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-6 text-slate-400 text-xs italic">No golfers with {minMajors}+ majors for this selection.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.owgr_player_id} onClick={() => setSelected(r)} className="hover:bg-slate-50 cursor-pointer">
                <td className="px-2 py-2 text-left">
                  <div className="text-xs font-semibold" style={{ color: "var(--forest-deep)" }}>{r.player}</div>
                  <div className="text-[10px] text-slate-500">{r.country ?? ""} · {r.debut_year}–{r.last_year}</div>
                </td>
                <NumCell>{r.majors_played}</NumCell>
                <NumCell gold={r.best_seed === 1}>{r.best_seed ?? "—"}</NumCell>
                <NumCell>{r.avg_seed ?? "—"}</NumCell>
                <PairCell count={r.cuts_made} pct={r.cut_pct} />
                <NumCell gold={r.wins > 0}>{r.wins}</NumCell>
                <PairCell count={r.top10s} pct={r.top10_pct} />
                <NumCell muted>{r.best_finish ?? "—"}</NumCell>
                <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-xs whitespace-nowrap" style={{ color: "var(--forest-deep)" }}>{r.avg_finish == null ? "—" : r.avg_finish.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-slate-400 text-xs italic">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs italic">No golfers with {minMajors}+ majors.</div>
        ) : rows.map((r) => (
          <div key={r.owgr_player_id} onClick={() => setSelected(r)} className="cursor-pointer">
            <MobileCard r={r} />
          </div>
        ))}
      </div>

      {selected && <GolferHistoryPanel golfer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ---- presentational bits (match GolferStatsView) --------------------
function NumCell({ children, gold, muted }: { children: React.ReactNode; gold?: boolean; muted?: boolean }) {
  return (
    <td className="px-2 py-2 text-center font-mono font-bold tabular-nums text-xs whitespace-nowrap"
      style={{ color: gold ? "var(--gold)" : muted ? undefined : "var(--forest-deep)" }}>
      <span className={muted ? "text-slate-600 font-normal" : ""}>{children}</span>
    </td>
  );
}

function PairCell({ count, pct }: { count: number; pct: number }) {
  return (
    <td className="px-2 py-2 text-center font-mono tabular-nums text-xs whitespace-nowrap">
      <span className="font-bold" style={{ color: "var(--forest-deep)" }}>{count}</span>
      <span className="text-slate-400"> · {pct}%</span>
    </td>
  );
}

function FilterSelect({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 border border-slate-200 rounded-md bg-white text-sm"
        style={{ color: "var(--forest-deep)" }}>
        {children}
      </select>
    </div>
  );
}

function SortHeader({ label, k, sk, sd, on, align }: {
  label: string; k: SortKey; sk: SortKey; sd: "asc" | "desc"; on: (k: SortKey) => void;
  align: "left" | "center" | "right";
}) {
  const active = sk === k;
  const arrow = active ? (sd === "asc" ? "▲" : "▼") : "";
  const a = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";
  return (
    <th className={`px-2 py-2 ${a} whitespace-nowrap`}>
      <button type="button" onClick={() => on(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-[color:var(--forest-deep)]" : "hover:text-[color:var(--forest-deep)]"}`}>
        {label}<span className="text-[8px]">{arrow}</span>
      </button>
    </th>
  );
}

function MobileCard({ r }: { r: GolferMajorStat }) {
  const cells = [
    { label: "MAJORS", value: String(r.majors_played) },
    { label: "CUT%", value: `${r.cut_pct}%` },
    { label: "WINS", value: String(r.wins), gold: r.wins > 0 },
    { label: "T10", value: String(r.top10s) },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--forest-deep)" }}>{r.player}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{r.country ?? ""} · {r.debut_year}–{r.last_year}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">Avg Pos</div>
          <div className="text-lg font-mono font-bold tabular-nums leading-tight mt-0.5" style={{ color: "var(--forest-deep)" }}>
            {r.avg_finish == null ? "—" : r.avg_finish.toFixed(1)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center">
        {cells.map((c) => <div key={c.label} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">{c.label}</div>)}
        {cells.map((c) => (
          <div key={`${c.label}-v`} className="text-sm font-mono font-bold tabular-nums leading-none mt-1"
            style={{ color: c.gold ? "var(--gold)" : "var(--forest-deep)" }}>{c.value}</div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span><span className="font-bold uppercase tracking-wider text-slate-400 mr-1">Best OWGR</span>
          <span className="font-mono font-semibold tabular-nums">{r.best_seed ?? "—"}</span></span>
        <span><span className="font-bold uppercase tracking-wider text-slate-400 mr-1">Best fin</span>
          <span className="font-mono font-semibold tabular-nums">{r.best_finish ?? "—"}</span></span>
      </div>
    </div>
  );
}

function years(): number[] {
  const out: number[] = [];
  for (let y = YEAR_MAX; y >= YEAR_MIN; y--) out.push(y);
  return out;
}
