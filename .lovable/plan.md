## Problem

On Chrome iOS portrait first load of `/home`, the authenticated shell can paint before the mobile header offset is stable. That makes the page content start underneath the top menu bar, hiding the "Major Season" heading and the top of the first tournament card.

The earlier sticky-only and spacer variants were still vulnerable because Chrome iOS may preserve or apply a stale scroll/layout offset during hydration.

## Fix

Use a deterministic mobile shell with the main content as the mobile scroll container:

1. `MobileTopBar` is `fixed` on mobile, with a fixed z-index and safe-area-aware height.
2. The main content gets matching safe-area-aware `padding-top`, so content can never begin underneath the fixed menu bar.
3. On mobile, `main` owns scrolling at `100dvh`, so Chrome iOS cannot apply a stale window scroll that places content underneath the fixed header.
4. Route changes under `_authenticated` force scroll restoration to `manual` and reset the window plus the main scroll container to `0` immediately, on the next animation frame, after load, and with short delayed fallbacks.

## Files

1. `src/components/mobile-shell.tsx` — mobile top bar is fixed at the top of the viewport.
2. `src/routes/_authenticated.tsx` — route-aware scroll reset and safe mobile shell main class.
3. `src/styles.css` — `.mobile-top-bar` and `.mobile-shell-main` reserve the exact header height including `env(safe-area-inset-top)`.

## Verification

Validated in a mobile portrait viewport: the top menu bar is visible, "Major Season" appears below it, and the first tournament card starts below the heading with no clipping.
