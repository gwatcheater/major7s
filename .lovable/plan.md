## Plan: Throttled route-activity last-seen tracker

Update `LastSeenTracker` in `src/routes/__root.tsx` so it stamps `profiles.last_seen_at` on route changes, throttled to once per 5 minutes per session.

### Changes

**File:** `src/routes/__root.tsx`

Replace the current `LastSeenTracker` (fires once on `user.id` change) with a route-aware, throttled version:

```tsx
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

function LastSeenTracker() {
  const { user } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });
  const lastStampRef = useRef<number>(0);

  useEffect(() => {
    if (!user?.id) return;
    const now = Date.now();
    if (now - lastStampRef.current < LAST_SEEN_THROTTLE_MS) return;
    lastStampRef.current = now;
    void supabase
      .from("profiles")
      .update({ last_seen_at: new Date(now).toISOString() })
      .eq("id", user.id)
      .then(({ error }) => {
        if (error) console.warn("[last-seen] update failed", error.message);
      });
  }, [user?.id, pathname]);

  return null;
}
```

### Behavior

- **First page load (authenticated):** stamps immediately (`lastStampRef = 0` → diff > 5 min).
- **Same-tab navigation:** every `pathname` change re-evaluates; writes only if ≥5 min since the last successful stamp in this session.
- **Idle on one page:** no writes (no route change → no effect re-run). Matches the spec ("user transitioned routes AND ≥5 min").
- **Sign-out / sign-in as different user:** `user.id` change re-runs the effect; throttle ref persists across renders but resets naturally on full page reload. (No cross-user leakage risk — the ref only gates writes, never identifies a user.)
- **Errors:** fire-and-forget, logged as warning, no UX impact.

### Out of scope

- No changes to the DB schema, RLS, admin UI, or sorting logic.
- No heartbeat/interval timer — spec explicitly ties refresh to route transitions.
- No cross-tab coordination (BroadcastChannel/localStorage). Each tab independently throttles; acceptable given 5-min cadence and cheap single-row updates.
