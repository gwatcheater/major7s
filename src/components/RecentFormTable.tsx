// =============================================================
// RecentFormTable.tsx (v2)
// "Recent Form" tab: golfer x event pivot with filters.
//   - Field toggle: This field (current major field) vs All players
//   - Tour chips: All / PGAT / DPWT — reshapes which event columns show
//   - Min events slider (flexes with the visible event count)
//   - Narrow uniform columns, short names + full name on hover
//   - Sticky header row + sticky golfer column
// Summary stats (Ev/W/T10/Best/Form) recompute from the VISIBLE events,
// so per-tour numbers are honest. Backed by form_events / form_matrix /
// current_field_player_ids.
// =============================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface FormEvent {
  event_id: number;
  event_name: string;
  tour_code: string;
  week: number;
  event_date: string | null;
}
interface FormGolferRaw {
  owgr_player_id: number;
  player: string;
  finishes: Record<string, number | "MC">;
  points: Record<string, number>;
}
type Cell = number | "MC" | undefined;

function useFormEvents() {
  return useQuery({
    queryKey: ["form-events"],
    queryFn: async (): Promise<FormEvent[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("form_events");
      if (error) throw new Error(error.message);
      return (data ?? []) as FormEvent[];
    },
  });
}
function useFormMatrix() {
  return useQuery({
    queryKey: ["form-matrix"],
    queryFn: async (): Promise<FormGolferRaw[]> => {
      const PAGE = 1000;
      const all: FormGolferRaw[] = [];
      for (let from = 0; from < 6000; from += PAGE) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)("form_matrix").range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as FormGolferRaw[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });
}
function useFieldIds() {
  return useQuery({
    queryKey: ["current-field-ids"],
    queryFn: async (): Promise<Set<number>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("current_field_player_ids");
      if (error) throw new Error(error.message);
      return new Set(((data ?? []) as { owgr_player_id: number }[]).map((r) => r.owgr_player_id));
    },
  });
}

function shortName(name: string): string {
  const n = name.replace(/\([^)]*\)/g, "").replace(/presented by.*$/i, "").trim();
  return n.length > 16 ? n.slice(0, 15).trim() + "…" : n;
}

function cellStyle(v: Cell): { bg: string; fg: string; weight: number; text: string } {
  if (v === undefined) return { bg: "transparent", fg: "var(--text-muted, #9aa79a)", weight: 400, text: "·" };
  if (v === "MC") return { bg: "transparent", fg: "var(--alert, #ef4444)", weight: 500, text: "MC" };
  if (v === 1) return { bg: "var(--gold)", fg: "var(--forest-deep)", weight: 600, text: "1" };
  if (v <= 5) return { bg: "#97C459", fg: "#173404", weight: 600, text: String(v) };
  if (v <= 10) return { bg: "#C0DD97", fg: "#173404", weight: 500, text: String(v) };
  return { bg: "transparent", fg: "#475569", weight: 400, text: String(v) };
}
function sortVal(v: Cell): number {
  if (v === undefined) return 1e9;
  if (v === "MC") return 1e8;
  return v;
}

type SumKey = "events" | "wins" | "top10s" | "best" | "formPts";
type SortKey = "player" | SumKey | `ev:${number}`;

const TOURS = ["All", "PGAT", "DPWT"] as const;

export default function RecentFormTable() {
  const { data: events = [], isLoading: le } = useFormEvents();
  const { data: golfers = [], isLoading: lg, error } = useFormMatrix();
  const { data: fieldIds } = useFieldIds();

  const [fieldOnly, setFieldOnly] = useState(true);
  const [tour, setTour] = useState<(typeof TOURS)[number]>("All");
  const [minEvents, setMinEvents] = useState(1);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("formPts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const visibleEvents = useMemo(
    () => events.filter((e) => tour === "All" || e.tour_code === tour),
    [events, tour],
  );
  const maxEvents = Math.max(1, visibleEvents.length);
  const minEv = Math.min(minEvents, maxEvents);

  // derive per-golfer summary over the VISIBLE events
  const derived = useMemo(() => {
    return golfers.map((g) => {
      let events_ = 0, wins = 0, top10s = 0, formPts = 0;
      let best: number | null = null;
      for (const ev of visibleEvents) {
        const id = String(ev.event_id);
        const f = g.finishes[id];
        if (f === undefined) continue;
        events_++;
        formPts += g.points[id] ?? 0;
        if (f !== "MC") {
          if (f === 1) wins++;
          if (f <= 10) top10s++;
          if (best === null || f < best) best = f;
        }
      }
      return { g, events: events_, wins, top10s, best, formPts: Math.round(formPts) };
    });
  }, [golfers, visibleEvents]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = derived.filter((d) =>
      d.events >= minEv &&
      (!fieldOnly || (fieldIds ? fieldIds.has(d.g.owgr_player_id) : true)) &&
      (!q || d.g.player.toLowerCase().includes(q)),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      if (sortKey === "player") return dir * a.g.player.localeCompare(b.g.player);
      if (sortKey.startsWith("ev:")) {
        const id = sortKey.slice(3);
        return dir * (sortVal(a.g.finishes[id]) - sortVal(b.g.finishes[id]));
      }
      const x = a[sortKey as SumKey], y = b[sortKey as SumKey];
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * ((x as number) - (y as number));
    });
    return r;
  }, [derived, search, minEv, fieldOnly, fieldIds, sortKey, sortDir]);

  function toggleSort(k: SortKey, asc = false) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "player" || asc ? "asc" : "desc"); }
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const loading = le || lg;

  if (error) {
    return <div className="text-center py-12 text-sm text-red-600">Failed to load form data. {(error as Error).message}</div>;
  }

  const sumCols: { k: SumKey; label: string; asc?: boolean }[] = [
    { k: "events", label: "Ev" },
    { k: "wins", label: "W" },
    { k: "top10s", label: "T10" },
    { k: "best", label: "Best", asc: true },
    { k: "formPts", label: "Form" },
  ];
  const chipCls = (on: boolean) =>
    `px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${
      on ? "shadow-sm" : "text-slate-500 hover:text-[color:var(--forest-deep)]"
    }`;
  const chipStyle = (on: boolean) => (on ? { backgroundColor: "var(--gold)", color: "var(--forest-deep)" } : undefined);

  return (
    <div>
      <div className="mb-3 text-xs text-slate-600 leading-relaxed">
        Recent form on the PGA Tour and DP World Tour heading into the major.
        <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> Form</span> is OWGR points earned (field-strength weighted). Blank = didn’t play. Sort any column.
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-3">
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Field</span>
          <div className="inline-flex rounded-full border border-slate-200 p-0.5">
            <button type="button" onClick={() => setFieldOnly(true)} className={chipCls(fieldOnly)} style={chipStyle(fieldOnly)}>This field</button>
            <button type="button" onClick={() => setFieldOnly(false)} className={chipCls(!fieldOnly)} style={chipStyle(!fieldOnly)}>All players</button>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tour</span>
          <div className="inline-flex rounded-full border border-slate-200 p-0.5">
            {TOURS.map((t) => (
              <button key={t} type="button" onClick={() => setTour(t)} className={chipCls(tour === t)} style={chipStyle(tour === t)}>{t}</button>
            ))}
          </div>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Min events</span>
          <input type="range" min={1} max={maxEvents} step={1} value={minEv}
            onChange={(e) => setMinEvents(Number(e.target.value))}
            className="w-24 accent-[color:var(--gold)]" />
          <span className="text-xs font-mono font-bold tabular-nums" style={{ color: "var(--forest-deep)" }}>{minEv}</span>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <input type="text" placeholder="Search golfers…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9 px-3 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]"
          style={{ color: "var(--forest-deep)" }} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">
          {loading ? "Loading…" : `${rows.length} golfers · ${visibleEvents.length} events`}
        </span>
      </div>

      <div className="border border-slate-200 rounded-md overflow-x-auto">
        <table className="text-xs" style={{ borderCollapse: "separate", borderSpacing: 0, whiteSpace: "nowrap" }}>
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th onClick={() => toggleSort("player")}
                className="px-2 py-2 text-left cursor-pointer sticky left-0 top-0 bg-slate-50 z-20" style={{ minWidth: 128 }}>
                Golfer{arrow("player")}
              </th>
              {sumCols.map((c) => (
                <th key={c.k} onClick={() => toggleSort(c.k, c.asc)}
                  className="px-2 py-2 text-center cursor-pointer sticky top-0 bg-slate-50 z-10">{c.label}{arrow(c.k)}</th>
              ))}
              {visibleEvents.map((ev) => (
                <th key={ev.event_id} onClick={() => toggleSort(`ev:${ev.event_id}`, true)}
                  title={ev.event_name}
                  className="px-1 py-2 text-center cursor-pointer sticky top-0 bg-slate-50 align-bottom"
                  style={{ width: 42, minWidth: 42 }}>
                  <div className="truncate" style={{ maxWidth: 42 }}>{shortName(ev.event_name)}</div>
                  <div className="text-[8px] text-slate-400 font-normal normal-case">
                    {ev.tour_code === "PGAT" ? "P" : "D"} {ev.week}{arrow(`ev:${ev.event_id}`)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6 + visibleEvents.length} className="text-center py-6 text-slate-400 italic">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6 + visibleEvents.length} className="text-center py-6 text-slate-400 italic">No golfers match these filters.</td></tr>
            ) : rows.map((d) => (
              <tr key={d.g.owgr_player_id} className="hover:bg-slate-50">
                <td className="px-2 py-2 text-left font-semibold sticky left-0 bg-white z-10" style={{ color: "var(--forest-deep)" }}>{d.g.player}</td>
                <td className="px-2 py-2 text-center tabular-nums">{d.events}</td>
                <td className="px-2 py-2 text-center tabular-nums font-semibold" style={{ color: d.wins > 0 ? "var(--gold)" : undefined }}>{d.wins}</td>
                <td className="px-2 py-2 text-center tabular-nums">{d.top10s}</td>
                <td className="px-2 py-2 text-center tabular-nums text-slate-600">{d.best ?? "—"}</td>
                <td className="px-2 py-2 text-center tabular-nums font-semibold" style={{ color: "var(--forest-deep)" }}>{d.formPts}</td>
                {visibleEvents.map((ev) => {
                  const s = cellStyle(d.g.finishes[String(ev.event_id)]);
                  return (
                    <td key={ev.event_id} className="text-center tabular-nums" style={{ padding: "8px 4px", width: 42, background: s.bg, color: s.fg, fontWeight: s.weight }}>
                      {s.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "var(--gold)" }} />Win</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "#97C459" }} />Top 5</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded" style={{ background: "#C0DD97" }} />Top 10</span>
        <span className="inline-flex items-center gap-1.5"><span className="font-semibold" style={{ color: "var(--alert, #ef4444)" }}>MC</span>missed cut</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-slate-400">·</span>did not play</span>
      </div>
    </div>
  );
}
