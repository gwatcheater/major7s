import { createFileRoute } from "@tanstack/react-router";
import { useMediaQuery } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/rules")({
  component: RulesPage,
});

function RulesPage() {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const t = isDesktop
    ? {
        pageBg: "#ffffff",
        heroBorder: "rgba(0,0,0,0.08)",
        heroSub: "#999",
        divider: "rgba(0,0,0,0.07)",
        sectionLabel: "#9a7a2e",
        scoringBg: "rgba(201,168,76,0.08)",
        scoringBorder: "rgba(201,168,76,0.3)",
        scoringTitle: "#9a7a2e",
        scoringBody: "#555",
        egBg: "rgba(201,168,76,0.1)",
        egBorder: "rgba(201,168,76,0.25)",
        egText: "#9a7a2e",
        toWinBg: "rgba(201,168,76,0.14)",
        toWinBorder: "rgba(201,168,76,0.55)",
        toWinTitle: "#9a7a2e",
        toWinBody: "#555",
        toWinStrong: "#9a7a2e",
        cutBg: "rgba(226,75,74,0.07)",
        cutBorder: "rgba(226,75,74,0.25)",
        cutTitle: "#c0302f",
        cutBody: "#555",
        cutStrong: "#1a1a1a",
        cutTagBg: "rgba(226,75,74,0.1)",
        cutTagBorder: "rgba(226,75,74,0.3)",
        cutTagText: "#c0302f",
        nfBg: "rgba(239,159,39,0.07)",
        nfBorder: "rgba(239,159,39,0.25)",
        nfTitle: "#a06b0a",
        nfBody: "#555",
        nfStrong: "#1a1a1a",
        nfTagText: "#c0302f",
        cardBg: "#f5f5f3",
        cardBorder: "rgba(0,0,0,0.07)",
        cardIconBg: "#e8e8e6",
        cardIconColor: "#666",
        cardTitle: "#1a1a1a",
        cardBody: "#888",
        owgrBg: "#f5f5f3",
        owgrBorder: "rgba(0,0,0,0.07)",
        owgrIconBg: "#e8e8e6",
        owgrIconColor: "#666",
        owgrBody: "#555",
        owgrStrong: "#1a1a1a",
        owgrLink: "#9a7a2e",
        pillBorder: "rgba(0,0,0,0.12)",
        pillText: "#aaa",
        footerBorder: "rgba(0,0,0,0.07)",
        heroTitle: "#1a1a1a",
      }
    : {
        pageBg: "var(--forest-deep)",
        heroBorder: "rgba(255,255,255,0.08)",
        heroSub: "rgba(255,255,255,0.35)",
        divider: "rgba(255,255,255,0.07)",
        sectionLabel: "var(--gold)",
        scoringBg: "rgba(201,168,76,0.07)",
        scoringBorder: "rgba(201,168,76,0.25)",
        scoringTitle: "var(--gold)",
        scoringBody: "rgba(255,255,255,0.45)",
        egBg: "rgba(201,168,76,0.08)",
        egBorder: "rgba(201,168,76,0.2)",
        egText: "rgba(201,168,76,0.7)",
        toWinBg: "rgba(201,168,76,0.13)",
        toWinBorder: "rgba(201,168,76,0.5)",
        toWinTitle: "var(--gold)",
        toWinBody: "rgba(255,255,255,0.55)",
        toWinStrong: "var(--gold)",
        cutBg: "rgba(226,75,74,0.07)",
        cutBorder: "rgba(226,75,74,0.22)",
        cutTitle: "#E24B4A",
        cutBody: "rgba(255,255,255,0.45)",
        cutStrong: "rgba(255,255,255,0.65)",
        cutTagBg: "rgba(226,75,74,0.14)",
        cutTagBorder: "rgba(226,75,74,0.5)",
        cutTagText: "#E24B4A",
        nfBg: "rgba(239,159,39,0.07)",
        nfBorder: "rgba(239,159,39,0.22)",
        nfTitle: "#EF9F27",
        nfBody: "rgba(255,255,255,0.45)",
        nfStrong: "rgba(255,255,255,0.65)",
        nfTagText: "rgba(226,75,74,0.8)",
        cardBg: "rgba(255,255,255,0.03)",
        cardBorder: "rgba(255,255,255,0.07)",
        cardIconBg: "rgba(255,255,255,0.06)",
        cardIconColor: "rgba(255,255,255,0.4)",
        cardTitle: "rgba(255,255,255,0.6)",
        cardBody: "rgba(255,255,255,0.3)",
        owgrBg: "rgba(255,255,255,0.03)",
        owgrBorder: "rgba(255,255,255,0.08)",
        owgrIconBg: "rgba(255,255,255,0.06)",
        owgrIconColor: "rgba(255,255,255,0.4)",
        owgrBody: "rgba(255,255,255,0.4)",
        owgrStrong: "rgba(255,255,255,0.6)",
        owgrLink: "var(--gold)",
        pillBorder: "rgba(255,255,255,0.1)",
        pillText: "rgba(255,255,255,0.3)",
        footerBorder: "rgba(255,255,255,0.07)",
        heroTitle: "#ffffff",
      };

  const picks = [
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ),
      title: "Picks close before the tournament starts",
      body: "Typically the evening before the first round. Once closed, no changes for any reason.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      ),
      title: "One golfer from each bucket",
      body: "You must select a golfer in every bucket. All seven picks are required to enter.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="8"/></svg>
      ),
      title: "Pre-tournament withdrawals",
      body: "If your pick withdraws before the first round, you keep that pick. They score 100 pts across all rounds.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      ),
      title: "Tied finishing positions",
      body: "Ties don't average down. Two players tied 3rd both score 3 pts each.",
    },
  ];

  return (
    <div className="min-h-screen transition-colors duration-200" style={{ backgroundColor: t.pageBg }}>
      <div className="max-w-2xl mx-auto px-6 py-10 pb-20">

        {/* Hero */}
        <div className="pb-8 mb-8" style={{ borderBottom: `0.5px solid ${t.heroBorder}` }}>
          <h1 className="text-4xl font-medium leading-tight mb-2" style={{ letterSpacing: "-0.02em", color: t.heroTitle }}>
            Four Majors.<br />
            Seven Picks.<br />
            <span style={{ color: "var(--gold)" }}>No Mercy.</span>
          </h1>
          <p className="text-sm italic" style={{ color: t.heroSub }}>
            Everyone's an expert until Sunday.
          </p>
        </div>

        {/* Scoring label */}
        <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: t.sectionLabel }}>
          Scoring
        </p>

        {/* Scoring panel */}
        <div className="rounded-xl p-5 flex gap-4 items-start mb-2.5" style={{ background: t.scoringBg, border: `0.5px solid ${t.scoringBorder}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(201,168,76,0.15)", color: "var(--gold)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: t.scoringTitle }}>Scoring</p>
            <p className="text-xs leading-relaxed" style={{ color: t.scoringBody }}>
              Finishing position is points. Your best 5 of 7 picks count - the two worst are dropped.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {["1st = 1 pt", "5th = 5 pts", "12th = 12 pts", "40th = 40 pts", "65th = 65 pts"].map((eg) => (
                <span key={eg} className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ background: t.egBg, border: `0.5px solid ${t.egBorder}`, color: t.egText }}>
                  {eg}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* To win panel */}
        <div className="rounded-xl p-5 flex gap-4 items-start mb-2.5" style={{ background: t.toWinBg, border: `1.5px solid ${t.toWinBorder}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(201,168,76,0.25)", color: "var(--gold)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: t.toWinTitle }}>To win</p>
            <p className="text-xs leading-relaxed" style={{ color: t.toWinBody }}>
              <span style={{ color: t.toWinStrong, fontWeight: 500 }}>Lowest total score wins.</span>{" "}
              In the event of a tied score, the prize for that position is combined and divided equally among the players in that tie.
            </p>
          </div>
        </div>

        {/* The CUT panel */}
        <div className="rounded-xl p-5 flex gap-4 items-start mb-2.5" style={{ background: t.cutBg, border: `0.5px solid ${t.cutBorder}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(226,75,74,0.14)", color: "#E24B4A" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: t.cutTitle }}>The CUT</p>
            <p className="text-xs leading-relaxed" style={{ color: t.cutBody }}>
              After 36 holes, the bottom half of the field is eliminated.{" "}
              <span style={{ color: t.cutStrong, fontWeight: 500 }}>Any pick who misses the CUT scores 100 pts.</span>{" "}
              With five of your seven picks counting, a cut hurts - but doesn't end your tournament.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <span className="text-[11px] font-medium px-2.5 py-0.5 rounded" style={{ border: `0.5px solid ${t.cutTagBorder}`, background: t.cutTagBg, color: t.cutTagText }}>
                CUT = 100 pts
              </span>
            </div>
          </div>
        </div>

        {/* Non-finishers panel */}
        <div className="rounded-xl p-5 flex gap-4 items-start" style={{ background: t.nfBg, border: `0.5px solid ${t.nfBorder}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(239,159,39,0.14)", color: "#EF9F27" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: t.nfTitle }}>Non-finishers</p>
            <p className="text-xs leading-relaxed" style={{ color: t.nfBody }}>
              Any golfer who doesn't complete the tournament scores{" "}
              <span style={{ color: t.nfStrong, fontWeight: 500 }}>100 pts</span>{" "}
              - regardless of when or why they stop playing.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {["WD - Withdrawal", "DQ - Disqualified", "DNF - Did not finish", "DNS - Did not start", "MDF - Made cut, did not finish"].map((tag) => (
                <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ border: "0.5px solid rgba(226,75,74,0.35)", background: "rgba(226,75,74,0.1)", color: t.nfTagText }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-7" style={{ height: "0.5px", background: t.divider }} />

        {/* Picks and deadlines */}
        <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: t.sectionLabel }}>
          Picks and deadlines
        </p>
        <div className="grid grid-cols-2 gap-2">
          {picks.map((card) => (
            <div key={card.title} className="rounded-lg p-4 flex gap-2.5 items-start" style={{ background: t.cardBg, border: `0.5px solid ${t.cardBorder}` }}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: t.cardIconBg, color: t.cardIconColor }}>
                {card.icon}
              </div>
              <div>
                <p className="text-[11px] font-medium mb-0.5" style={{ color: t.cardTitle }}>{card.title}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: t.cardBody }}>{card.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="my-7" style={{ height: "0.5px", background: t.divider }} />

        {/* OWGR */}
        <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: t.sectionLabel }}>
          OWGR and bucket assignment
        </p>
        <div className="rounded-xl p-5 flex gap-4 items-start" style={{ background: t.owgrBg, border: `0.5px solid ${t.owgrBorder}` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: t.owgrIconBg, color: t.owgrIconColor }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div className="text-xs leading-relaxed" style={{ color: t.owgrBody }}>
            <p className="mb-3">
              Buckets are filled using the{" "}
              <span style={{ color: t.owgrStrong, fontWeight: 500 }}>Official World Golf Ranking (OWGR)</span>
              . Once the full field is confirmed, we lock in a specific OWGR week number - that snapshot determines which bucket every player falls into.
            </p>
            <p>
              Late additions (late qualifiers, standby callups, withdrawal replacements) slot into the bucket matching their ranking at the same locked week. In rare cases this expands a bucket slightly. Current rankings at{" "}
              <a href="https://www.owgr.com/archive" target="_blank" rel="noopener noreferrer" style={{ color: t.owgrLink, textDecoration: "none" }}>
                owgr.com
              </a>
              .
            </p>
          </div>
        </div>

        {/* Major pills footer */}
        <div className="flex flex-wrap gap-1.5 justify-center mt-8 pt-6" style={{ borderTop: `0.5px solid ${t.footerBorder}` }}>
          {["Masters", "PGA Championship", "US Open", "The Open"].map((m) => (
            <span key={m} className="text-[10px] px-3 py-1 rounded-full" style={{ color: t.pillText, border: `0.5px solid ${t.pillBorder}` }}>
              {m}
            </span>
          ))}
        </div>

      </div>
    </div>
  );
}
