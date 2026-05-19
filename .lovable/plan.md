## Fix: clicking a tournament card skips the hub

### Root cause
`src/lib/tournament-link.ts` routes cards directly to `/tournament/$id/lineup` whenever a tournament is `open_for_picks` and the deadline hasn't passed. The "US Open 2026" is in that state, so the whole card click bypasses the new `TournamentHub` detail page.

### Change
Make the card click always land on `/tournament/$id` (the hub). Keep a separate inline CTA on the card for the lineup picker when picks are open.

1. **`src/lib/tournament-link.ts`** — simplify `tournamentCardLink` to always return `{ to: "/tournament/$id", params: { id } }`. Update its existing unit test (`src/test/tournament-card-link.test.tsx`) to assert this new behavior.
2. **`src/routes/_authenticated/home.tsx`** — keep the outer `<Link>` going to the hub (via the simplified helper). Convert the visual "Enter / Edit Lineup →" pill into a real nested `<Link to="/tournament/$id/lineup">` with `onClick={(e) => e.stopPropagation()}` so it deep-links into the picker without triggering the outer card link. Render it only when `isOpen && !lockExpired`.

No DB or other route changes; the hub page (which you just built) renders on click, and "Enter Lineup" stays one tap away.
