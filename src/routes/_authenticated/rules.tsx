import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/rules")({
  head: () => ({
    meta: [
      { title: "How to Play - Major7s" },
      { name: "description", content: "Four Majors. Seven Picks. No Mercy. Everyone's an expert until Sunday." },
      { property: "og:title", content: "How to Play - Major7s" },
      { property: "og:description", content: "Four Majors. Seven Picks. No Mercy. Everyone's an expert until Sunday." },
      { property: "og:url", content: "https://www.major7s.com/rules" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://www.major7s.com/apple-touch-icon.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "How to Play - Major7s" },
      { name: "twitter:description", content: "Four Majors. Seven Picks. No Mercy. Everyone's an expert until Sunday." },
      { name: "twitter:image", content: "https://www.major7s.com/apple-touch-icon.png" },
    ],
  }),
  component: RulesPage,
});

function RulesPage() {
  const picks = [
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ),
      title: "Picks close before the tournament starts",
      body: "Typically the evening before the first round. Once closed, no changes for any reason.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      ),
      title: "One golfer from each bucket",
      body: "You must select a golfer in every bucket. All seven picks are required to enter.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="8"/></svg>
      ),
      title: "Pre-tournament withdrawals",
      body: "If your pick withdraws before the first round, you keep that pick. They score 100 pts across all rounds.",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      ),
      title: "Tied finishing positions",
      body: "Ties don't average down. Two players tied 3rd both score 3 pts each.",
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#243d24", color: "#fff" }}>
        <div className="max-w-2xl lg:max-w-4xl mx-auto px-6 lg:px-16 py-10 lg:py-16 pb-20">

          {/* Hero */}
          <div className="pb-8 mb-8" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.12)" }}>
            <h1 className="font-medium leading-tight mb-3 text-4xl lg:text-6xl" style={{ letterSpacing: "-0.02em", color: "#fff" }}>
              Four Majors.<br />
              Seven Picks.<br />
              <span style={{ color: "var(--gold)" }}>No Mercy.</span>
            </h1>
            <p className="italic text-sm lg:text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>
              Everyone's an expert until Sunday.
            </p>
          </div>

          {/* Scoring label */}
          <p className="font-medium uppercase tracking-widest mb-3 text-[10px] lg:text-[12px]" style={{ color: "var(--gold)" }}>
            Scoring
          </p>

          {/* Scoring panel */}
          <div className="rounded-xl flex gap-4 items-start mb-2.5 p-5 lg:p-6" style={{ background: "rgba(201,168,76,0.1)", border: "0.5px solid rgba(201,168,76,0.3)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0 w-9 h-9 lg:w-12 lg:h-12" style={{ background: "rgba(201,168,76,0.18)", color: "var(--gold)" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>
            </div>
            <div>
              <p className="font-medium mb-1 text-sm lg:text-lg" style={{ color: "#d4aa50" }}>Scoring</p>
              <p className="leading-relaxed text-xs lg:text-base" style={{ color: "rgba(255,255,255,0.6)" }}>
                Finishing position is points. Your best 5 of 7 picks count - the two worst are dropped.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {["1st = 1 pt", "5th = 5 pts", "12th = 12 pts", "40th = 40 pts", "65th = 65 pts"].map((eg) => (
                  <span key={eg} className="font-medium px-2 py-0.5 rounded text-[10px] lg:text-[12px]" style={{ background: "rgba(201,168,76,0.1)", border: "0.5px solid rgba(201,168,76,0.25)", color: "#C9A84C" }}>
                    {eg}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* To win panel */}
          <div className="rounded-xl flex gap-4 items-start mb-2.5 p-5 lg:p-6" style={{ background: "rgba(201,168,76,0.16)", border: "1.5px solid rgba(201,168,76,0.55)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0 w-9 h-9 lg:w-12 lg:h-12" style={{ background: "rgba(201,168,76,0.28)", color: "var(--gold)" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
            </div>
            <div>
              <p className="font-medium mb-1 text-sm lg:text-lg" style={{ color: "#d4aa50" }}>To win</p>
              <p className="leading-relaxed text-xs lg:text-base" style={{ color: "rgba(255,255,255,0.6)" }}>
                <span style={{ color: "var(--gold)", fontWeight: 500 }}>Lowest total score wins.</span>{" "}
                In the event of a tied score, the prize for that position is combined and divided equally among the players in that tie.
              </p>
            </div>
          </div>

          {/* The CUT panel */}
          <div className="rounded-xl flex gap-4 items-start mb-2.5 p-5 lg:p-6" style={{ background: "rgba(226,75,74,0.09)", border: "0.5px solid rgba(226,75,74,0.28)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0 w-9 h-9 lg:w-12 lg:h-12" style={{ background: "rgba(226,75,74,0.16)", color: "#E24B4A" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
            </div>
            <div>
              <p className="font-medium mb-1 text-sm lg:text-lg" style={{ color: "#e05554" }}>The CUT</p>
              <p className="leading-relaxed text-xs lg:text-base" style={{ color: "rgba(255,255,255,0.6)" }}>
                After 36 holes, the bottom half of the field is eliminated.{" "}
                <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>Any pick who misses the CUT scores 100 pts.</span>{" "}
                With five of your seven picks counting, a cut hurts - but doesn't end your tournament.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <span className="font-medium px-2.5 py-0.5 rounded text-[11px] lg:text-[14px]" style={{ border: "0.5px solid rgba(226,75,74,0.55)", background: "rgba(226,75,74,0.16)", color: "#E24B4A" }}>
                  CUT = 100 pts
                </span>
              </div>
            </div>
          </div>

          {/* Non-finishers panel */}
          <div className="rounded-xl flex gap-4 items-start p-5 lg:p-6" style={{ background: "rgba(239,159,39,0.09)", border: "0.5px solid rgba(239,159,39,0.28)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0 w-9 h-9 lg:w-12 lg:h-12" style={{ background: "rgba(239,159,39,0.16)", color: "#EF9F27" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
            </div>
            <div>
              <p className="font-medium mb-1 text-sm lg:text-lg" style={{ color: "#EF9F27" }}>Non-finishers</p>
              <p className="leading-relaxed text-xs lg:text-base" style={{ color: "rgba(255,255,255,0.6)" }}>
                Any golfer who doesn't complete the tournament scores{" "}
                <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>100 pts</span>{" "}
                - regardless of when or why they stop playing.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {["WD - Withdrawal", "DQ - Disqualified", "DNF - Did not finish", "DNS - Did not start", "MDF - Made cut, did not finish"].map((tag) => (
                  <span key={tag} className="font-medium px-2 py-0.5 rounded text-[10px] lg:text-[12px]" style={{ border: "0.5px solid rgba(226,75,74,0.4)", background: "rgba(226,75,74,0.12)", color: "#e05554" }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="my-7 lg:my-8" style={{ height: "0.5px", background: "rgba(255,255,255,0.1)" }} />

          {/* Picks and deadlines */}
          <p className="font-medium uppercase tracking-widest mb-3 text-[10px] lg:text-[12px]" style={{ color: "var(--gold)" }}>
            Picks and deadlines
          </p>
          <div className="grid grid-cols-2 gap-2 lg:gap-3">
            {picks.map((card) => (
              <div key={card.title} className="rounded-lg flex gap-2.5 items-start p-4 lg:p-5" style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)" }}>
                <div className="rounded-md flex items-center justify-center shrink-0 w-7 h-7 lg:w-10 lg:h-10" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
                  {card.icon}
                </div>
                <div>
                  <p className="font-medium mb-0.5 text-[11px] lg:text-[14px]" style={{ color: "rgba(255,255,255,0.75)" }}>{card.title}</p>
                  <p className="leading-relaxed text-[11px] lg:text-[14px]" style={{ color: "rgba(255,255,255,0.4)" }}>{card.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="my-7 lg:my-8" style={{ height: "0.5px", background: "rgba(255,255,255,0.1)" }} />

          {/* OWGR */}
          <p className="font-medium uppercase tracking-widest mb-3 text-[10px] lg:text-[12px]" style={{ color: "var(--gold)" }}>
            OWGR and bucket assignment
          </p>
          <div className="rounded-xl flex gap-4 items-start p-5 lg:p-6" style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
            <div className="rounded-lg flex items-center justify-center shrink-0 w-9 h-9 lg:w-12 lg:h-12" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div className="leading-relaxed text-xs lg:text-base" style={{ color: "rgba(255,255,255,0.55)" }}>
              <p className="mb-3">
                Buckets are filled using the{" "}
                <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>Official World Golf Ranking (OWGR)</span>
                . Once the full field is confirmed, we lock in a specific OWGR week number - that snapshot determines which bucket every player falls into.
              </p>
              <p>
                Late additions (late qualifiers, standby callups, withdrawal replacements) slot into the bucket matching their ranking at the same locked week. In rare cases this expands a bucket slightly. Current rankings at{" "}
                <a href="https://www.owgr.com/archive" target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)", textDecoration: "none" }}>
                  owgr.com
                </a>
                .
              </p>
            </div>
          </div>

          {/* Major pills footer */}
          <div className="flex flex-wrap gap-1.5 justify-center mt-8 pt-6" style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
            {["Masters", "PGA Championship", "US Open", "The Open"].map((m) => (
              <span key={m} className="px-3 py-1 rounded-full text-[10px] lg:text-[12px]" style={{ color: "rgba(255,255,255,0.35)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
                {m}
              </span>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
