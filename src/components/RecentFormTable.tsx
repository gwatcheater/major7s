// =============================================================
// RecentFormTable.tsx
// "Recent Form" tab: golfers x recent PGAT/DPWT events pivot, finishing
// position per cell, sortable, blank = didn't play. Backed by form_events()
// and form_matrix() over owgr_form_results. Styling mirrors the stats page.
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
interface FormGolfer {
  owgr_player_id: number;
  player: string;
  events_played: number;
  wins: number;
  top10s: number;
  best_finish: number | null;
  form_pts: number;
  finishes: Record<string, number | "MC">;
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
    queryFn: async (): Promise<FormGolfer[]> => {
      const PAGE = 1000;
      const all: FormGolfer[] = [];
      for (let from = 0; from < 6000; from += PAGE) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)("form_matrix").range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as FormGolfer[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });
}

// short header label from a long event name
function shortName(name: string): string {
  const n = name.replace(/\([^)]*\)/g, "").replace(/presented by.*$/i, "").trim();
  return n.length > 18 ? n.slice(0, 17).trim() + "…" : n;
}

type SortKey = "player" | "events_played" | "wins" | "top10s" | "best_finish" | "form_pts" | `ev:${number}`;

function cellStyle(v: Cell): { bg: string; fg: string; weight: number; text: string } {
  if (v === undefined) return { bg: "transparent", fg: "var(--text-muted, #9aa79a)", weight: 400, text: "·" };
  if (v === "MC") return { bg: "transparent", fg: "var(--alert, #ef4444)", weight: 500, text: "MC" };
  if (v === 1) return { bg: "var(--gold)", fg: "var(--forest-deep)", weight: 600, text: "1" };
  if (v <= 5) return { bg: "#97C459", fg: "#173404", weight: 600, text: String(v) };
  if (v <= 10) return { bg: "#C0DD97", fg: "#173404", weight: 500, text: String(v) };
  return { bg: "transparent", fg: "#475569", weight: 400, text: String(v) };
}

// numeric value for sorting an event column: best (low) first, then MC, then DNP
function sortVal(v: Cell): number {
  if (v === undefined) return 1e9;
  if (v === "MC") return 1e8;
  return v;
}

export default function RecentFormTable() {
  const { data: events = [], isLoading: le } = useFormEvents();
  const { data: golfers = [], isLoading: lg, error } = useFormMatrix();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("form_pts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = golfers.filter((g) => !q || g.player.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      if (sortKey === "player") return dir * a.player.localeCompare(b.player);
      if (sortKey.startsWith("ev:")) {
        const id = sortKey.slice(3);
        return dir * (sortVal(a.finishes[id]) - sortVal(b.finishes[id]));
      }
      const x = a[sortKey as keyof FormGolfer] as number | null;
      const y = b[sortKey as keyof FormGolfer] as number | null;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * ((x as number) - (y as number));
    });
    return r;
  }, [golfers, search, sortKey, sortDir]);

  function toggleSort(k: SortKey, numericDefault: "asc" | "desc" = "desc") {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "player" ? "asc" : numericDefault); }
  }

  const loading = le || lg;
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  if (error) {
    return <div className="text-center py-12 text-sm text-red-600">Failed to load form data. {(error as Error).message}</div>;
  }

  const sumCols: { k: SortKey; label: string; asc?: boolean }[] = [
    { k: "events_played", label: "Ev" },
    { k: "wins", label: "W" },
    { k: "top10s", label: "T10" },
    { k: "best_finish", label: "Best", asc: true },
    { k: "form_pts", label: "Form pts" },
  ];

  return (
    <div>
      <div className="mb-3 text-xs text-slate-600 leading-relaxed">
        Recent form across PGA Tour and DP World Tour events heading into the major.
        <span className="font-semibold" style={{ color: "var(--forest-deep)" }}> Form pts</span> is total OWGR points earned (field-strength weighted). Blank = didn’t play. Sort any column.
      </div>

      <div className="mb-3">
        <input type="text" placeholder="Search golfers…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-9 px-3 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]"
          style={{ color: "var(--forest-deep)" }} />
      </div>

      <div className="border border-slate-200 rounded-md overflow-x-auto">
        <table className="text-xs" style={{ borderCollapse: "separate", borderSpacing: 0, whiteSpace: "nowrap" }}>
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th onClick={() => toggleSort("player")}
                className="px-2 py-2 text-left cursor-pointer sticky left-0 bg-slate-50 z-10"
                style={{ minWidth: 132 }}>Golfer{arrow("player")}</th>
              {sumCols.map((c) => (
                <th key={c.k} onClick={() => toggleSort(c.k, c.asc ? "asc" : "desc")}
                  className="px-2 py-2 text-center cursor-pointer bg-slate-50">{c.label}{arrow(c.k)}</th>
              ))}
              {events.map((ev) => (
                <th key={ev.event_id} onClick={() => toggleSort(`ev:${ev.event_id}`, "asc")}
                  title={ev.event_name}
                  className="px-2 py-2 text-center cursor-pointer bg-slate-50 align-bottom">
                  <div>{shortName(ev.event_name)}{arrow(`ev:${ev.event_id}`)}</div>
                  <div className="text-[8px] text-slate-400 font-normal normal-case">{ev.tour_code} {ev.week}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6 + events.length} className="text-center py-6 text-slate-400 italic">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6 + events.length} className="text-center py-6 text-slate-400 italic">No golfers.</td></tr>
            ) : rows.map((g) => (
              <tr key={g.owgr_player_id} className="hover:bg-slate-50">
                <td className="px-2 py-2 text-left font-semibold sticky left-0 bg-white hover:bg-slate-50"
                  style={{ color: "var(--forest-deep)" }}>{g.player}</td>
                <td className="px-2 py-2 text-center tabular-nums">{g.events_played}</td>
                <td className="px-2 py-2 text-center tabular-nums font-semibold"
                  style={{ color: g.wins > 0 ? "var(--gold)" : undefined }}>{g.wins}</td>
                <td className="px-2 py-2 text-center tabular-nums">{g.top10s}</td>
                <td className="px-2 py-2 text-center tabular-nums text-slate-600">{g.best_finish ?? "—"}</td>
                <td className="px-2 py-2 text-center tabular-nums font-semibold" style={{ color: "var(--forest-deep)" }}>{g.form_pts}</td>
                {events.map((ev) => {
                  const s = cellStyle(g.finishes[String(ev.event_id)]);
                  return (
                    <td key={ev.event_id} className="text-center tabular-nums"
                      style={{ padding: "8px 8px", background: s.bg, color: s.fg, fontWeight: s.weight }}>
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
