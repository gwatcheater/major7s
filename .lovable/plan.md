## Problem

Both the `sticky` and the `fixed + spacer` approaches produce the same symptom in Chrome iOS: on first load of `/home` the page is rendered with a non-zero scroll offset, so the "Major Season" heading and the top of the first card sit behind/above the chrome header.

The screenshot confirms this: the "OPEN FOR PICKS" / "PICKS SELECTED" badges (which live ~100px into the card) are pinned at the top of the visible area. The card itself is not clipped — the **viewport is scrolled down** before first paint.

This is a known Chrome iOS WKWebView behaviour: when the SSR HTML is taller than the hydrated DOM (fonts loading, layout shifts as React rehydrates), Chrome iOS preserves a scroll offset from the pre-hydration paint. Safari and desktop Chrome reset to 0; Chrome iOS does not.

The previous fixes were targeting layout (sticky vs fixed), but the layout was never the real problem. The header was correctly sized; the page was just scrolled past it.

## Fix

Two changes:

### 1. Revert `MobileTopBar` to `sticky`, remove the spacer

`fixed + spacer` adds complexity for no benefit (since the real issue isn't sticky height resolution). `sticky` is simpler, scrolls naturally, and matches the original design.

- **`src/components/mobile-shell.tsx`** — change header back to `sticky top-0`. Delete the `MobileTopBarSpacer` export.
- **`src/routes/_authenticated.tsx`** — remove `MobileTopBarSpacer` import and its render. Remove the now-stale "FIX:" comment. `<main>` stays as-is (no `mt-*` needed because sticky reserves its own height in flow).

### 2. Force scroll to top on every route mount under `_authenticated`

Add a one-shot scroll reset that runs on layout mount and after the first paint, defeating Chrome iOS's preserved offset.

In `src/routes/_authenticated.tsx`, replace the existing resize-dispatch `useEffect` with:

```ts
useEffect(() => {
  // Chrome iOS WKWebView occasionally preserves a non-zero scroll offset
  // from the SSR pre-hydration paint. Force the viewport back to the top
  // on initial mount, with rAF + a short timeout fallback to outrun
  // font-swap and hydration layout shifts.
  const reset = () => window.scrollTo(0, 0);
  reset();
  requestAnimationFrame(reset);
  const t = setTimeout(reset, 150);
  return () => clearTimeout(t);
}, []);
```

This runs once per `_authenticated` layout mount (i.e. on first load and after any full reload), and is a no-op on desktop / Safari where scroll is already 0.

### Files

1. `src/components/mobile-shell.tsx` — revert header to `sticky top-0`; remove `MobileTopBarSpacer`.
2. `src/routes/_authenticated.tsx` — remove spacer import + render; replace `useEffect` with scroll-to-top.
3. `.lovable/plan.md` — update with new diagnosis (Chrome iOS preserved scroll offset, not sticky height).

No changes to `home.tsx`, `styles.css`, or `__root.tsx`.

## Verification

After the change, on Chrome iOS portrait first load of `/home`:
- Page lands at scroll 0; "Major Season" heading visible directly under the header.
- First tournament card sits fully below the header with no clipping.
- Subsequent navigation, rotation, and reload all match.
- Desktop and Safari unaffected (scroll was already 0; `scrollTo(0,0)` is idempotent).
