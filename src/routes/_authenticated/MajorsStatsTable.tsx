// =====================================================================
// MajorsStatsTable.tsx
// Global majors performance table, backed by the golfer_major_stats RPC.
// Major / year / min-majors filters re-aggregate on the server (debounced);
// search / nationality / sort are client-side on the returned set.
//
// WIRE UP (2 things):
//   1. import your Supabase browser client below (marked ADJUST).
//   2. pass onSelectGolfer to route into Golfer Stats (marked ADJUST).
//
// THEME: colours reference CSS vars you already use. If your token names
// differ, remap the THEME object - nothing else needs touching.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";

// ADJUST: point at your Supabase browser client instance.
import { supabase } from "@/lib/supabase";

// ---- theme (remap to your tokens if names differ) -------------------
const THEME = {
  bg: "var(--forest-deep)",
  bgAlt: "var(--surface-muted)",
  gold: "var(--gold)",
  text: "var(--text, #e8e6df)",
  textMuted: "var(--text-muted, #9aa79a)",
  border: "var(--border, rgba(255,255,255,0.08))",
};

// ---- types ----------------------------------------------------------
type GolferStat = {
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
};

type ServerFilters = {
  major: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  minMajors: number;
};

const MAJORS = ["Masters", "PGA", "US Open", "The Open"] as const;
const YEAR_MIN = 2000;
const YEAR_MAX = new Date().getFullYear();

// ---- tiny debounce hook ---------------------------------------------
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---- data hook: server-side aggregate -------------------------------
function useGolferMajorStats(filters: ServerFilters) {
  const [data, setData] = useState<GolferStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .rpc("golfer_major_stats", {
        p_major: filters.major,
        p_year_from: filters.yearFrom,
        p_year_to: filters.yearTo,
        p_min_majors: filters.minMajors,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setData((data as GolferStat[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.major, filters.yearFrom, filters.yearTo, filters.minMajors]);

  return { data, loading, error };
}

// ---- column config (seed columns sit next to identity) --------------
type Col = { key: keyof GolferStat; label: string; kind: "txt" | "num" | "f" | "pair"; cnt?: keyof GolferStat; pct?: keyof GolferStat };
const COLS: Col[] = [
  { key: "player", label: "Player", kind: "txt" },
  { key: "country", label: "Nat", kind: "txt" },
  { key: "majors_played", label: "Majors", kind: "num" },
  { key: "best_seed", label: "OWGR seed · best", kind: "num" },
  { key: "avg_seed", label: "OWGR seed · avg", kind: "num" },
  { key: "cut_pct", label: "Cuts", kind: "pair", cnt: "cuts_made", pct: "cut_pct" },
  { key: "wins", label: "Wins", kind: "num" },
  { key: "top10s", label: "Top 10", kind: "pair", cnt: "top10s", pct: "top10_pct" },
  { key: "best_finish", label: "Best", kind: "num" },
  { key: "avg_finish", label: "Avg fin", kind: "f" },
  { key: "total_points", label: "Points", kind: "num" },
  { key: "debut_year", label: "Debut", kind: "num" },
  { key: "last_year", label: "Last", kind: "num" },
];

export default function MajorsStatsTable({
  onSelectGolfer,
}: {
  onSelectGolfer?: (owgrPlayerId: number) => void;
}) {
  // server-side (re-aggregating) filters
  const [major, setMajor] = useState<string | null>(null);
  const [yearFrom, setYearFrom] = useState<number>(YEAR_MIN);
  const [yearTo, setYearTo] = useState<number>(YEAR_MAX);
  const [minMajors, setMinMajors] = useState<number>(12);

  const serverFilters = useDebounced<ServerFilters>(
    { major, yearFrom, yearTo, minMajors },
    300
  );
  const { data, loading, error } = useGolferMajorStats(serverFilters);

  // client-side filters + sort
  const [q, setQ] = useState("");
  const [nat, setNat] = useState("");
  const [sortKey, setSortKey] = useState<keyof GolferStat>("majors_played");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  // stable nationality list: monotonic union so it never flickers/shrinks
  const natUnion = useRef<Set<string>>(new Set());
  data.forEach((d) => d.country && natUnion.current.add(d.country));
  const natOptions = useMemo(
    () => Array.from(natUnion.current).sort(),
    [data.length]
  );

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = data.filter(
      (d) =>
        (!ql || d.player.toLowerCase().includes(ql)) &&
        (!nat || d.country === nat)
    );
    r = [...r].sort((a, b) => {
      const x = a[sortKey] as number | string | null;
      const y = b[sortKey] as number | string | null;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string") return sortDir * x.localeCompare(y as string);
      return sortDir * ((x as number) - (y as number));
    });
    return r;
  }, [data, q, nat, sortKey, sortDir]);

  function toggleSort(c: Col) {
    if (sortKey === c.key) setSortDir((d) => (d * -1) as 1 | -1);
    else {
      setSortKey(c.key);
      setSortDir(c.kind === "txt" ? 1 : -1);
    }
  }

  const ctrl: React.CSSProperties = {
    background: THEME.bgAlt,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
  };

  return (
    <div style={{ color: THEME.text, fontSize: 13 }}>
      {/* filter rail */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search player"
          style={{ ...ctrl, flex: 1, minWidth: 160 }}
          aria-label="Search player"
        />
        <select value={major ?? ""} onChange={(e) => setMajor(e.target.value || null)} style={ctrl} aria-label="Major">
          <option value="">All majors</option>
          {MAJORS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select value={nat} onChange={(e) => setNat(e.target.value)} style={ctrl} aria-label="Nationality">
          <option value="">All nations</option>
          {natOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 12, color: THEME.textMuted }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Year</span>
          <select value={yearFrom} onChange={(e) => setYearFrom(+e.target.value)} style={ctrl}>
            {years().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span>–</span>
          <select value={yearTo} onChange={(e) => setYearTo(+e.target.value)} style={ctrl}>
            {years().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Min majors</span>
          <input type="range" min={1} max={80} step={1} value={minMajors} onChange={(e) => setMinMajors(+e.target.value)} style={{ width: 120 }} />
          <span style={{ color: THEME.gold, fontWeight: 500, minWidth: 20 }}>{minMajors}</span>
        </label>
        <span style={{ marginLeft: "auto", color: THEME.text }}>
          {loading ? "Loading…" : `${rows.length} golfer${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error && <div style={{ color: "var(--danger, #d47)", marginBottom: 12 }}>Couldn’t load stats. {error}</div>}

      <div style={{ overflowX: "auto", border: `1px solid ${THEME.border}`, borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap", minWidth: 820 }}>
          <thead>
            <tr style={{ background: THEME.bgAlt }}>
              {COLS.map((c) => {
                const num = c.kind !== "txt";
                const active = sortKey === c.key;
                return (
                  <th
                    key={String(c.key)}
                    onClick={() => toggleSort(c)}
                    style={{
                      padding: "9px 10px",
                      textAlign: num ? "right" : "left",
                      cursor: "pointer",
                      userSelect: "none",
                      color: active ? THEME.gold : THEME.textMuted,
                      fontWeight: 500,
                      borderBottom: `1px solid ${THEME.border}`,
                    }}
                  >
                    {c.label}{" "}
                    <span style={{ color: THEME.gold, fontSize: 10 }}>
                      {active ? (sortDir < 0 ? "▼" : "▲") : ""}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr
                key={d.owgr_player_id}
                onClick={() => onSelectGolfer?.(d.owgr_player_id)}
                style={{
                  background: i % 2 ? THEME.bg : "transparent",
                  borderBottom: `1px solid ${THEME.border}`,
                  cursor: onSelectGolfer ? "pointer" : "default",
                }}
              >
                {COLS.map((c) => {
                  const num = c.kind !== "txt";
                  let content: React.ReactNode;
                  if (c.kind === "pair") {
                    content = (
                      <>
                        {d[c.cnt!] as number}
                        <span style={{ color: THEME.textMuted, fontSize: 11 }}> · {d[c.pct!] as number}%</span>
                      </>
                    );
                  } else if (c.kind === "f") {
                    const v = d[c.key] as number | null;
                    content = v == null ? "—" : v.toFixed(1);
                  } else if (c.key === "player") {
                    content = <span style={{ fontWeight: 500 }}>{d.player}</span>;
                  } else if (c.key === "wins" && d.wins > 0) {
                    content = <span style={{ color: THEME.gold, fontWeight: 500 }}>{d.wins}</span>;
                  } else {
                    const v = d[c.key];
                    content = v == null ? "—" : (v as React.ReactNode);
                  }
                  return (
                    <td key={String(c.key)} style={{ padding: "8px 10px", textAlign: num ? "right" : "left" }}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function years(): number[] {
  const out: number[] = [];
  for (let y = YEAR_MAX; y >= YEAR_MIN; y--) out.push(y);
  return out;
}
