# Last seen → absolute local timestamp

Scope: `src/components/admin/users-directory-tab.tsx` only. No other files.

## Changes

1. **Replace `lastSeenLabel` (lines 85–93)** with absolute formatting using the admin's local timezone. Implementation:
   - Return `"—"` when null.
   - Format as `YYYY-MM-DD HH:mm` via `Intl.DateTimeFormat(undefined, { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })` (rearranged to ISO-like order to satisfy the requested `YYYY-MM-DD HH:mm` shape).
   - Append the resolved local zone abbreviation/offset using `Intl.DateTimeFormat(undefined, { timeZoneName:'short' })` and extracting the `timeZoneName` part (falls back to `GMT±HH:mm` from `Date#toString` if absent).
   - Final output example: `2026-06-26 14:32 (BST)`.

2. **Desktop table cell (line 423)** — already calls `lastSeenLabel(...)`, so it picks up the new format automatically.

3. **Mobile card view (lines 946–947)** — replace the inline `new Date(...).toLocaleString("en-GB")` with a call to the same new `lastSeenLabel(user.last_sign_in_at)` so desktop and mobile are identical.

4. **Sorting (lines 239–241)** — unchanged. It already sorts by `new Date(last_sign_in_at).getTime()`, independent of the rendered string.

5. **CSV export (line 518)** — leave as-is (out of scope; user only asked about the column display).

No data, route, server, or styling changes. No new dependencies.
