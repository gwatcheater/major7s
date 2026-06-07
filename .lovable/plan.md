
## Problem

The `MobileTopBar` uses `position: sticky` inside the flex column layout in `src/routes/_authenticated.tsx`. On Chrome iOS first paint, the sticky element's height isn't reliably reserved in the flow, so the first tournament card renders under the header until a reflow event (rotate, reload, pinch). Current workaround (`mt-16` on `<main>` + a "Major Season" heading buffer) hides — but doesn't fix — the issue.

## Fix

Replace sticky with **fixed header + explicit spacer**. A fixed header is removed from the flow entirely, and an adjacent in-flow `<div>` of the exact same height (`h-16`) guarantees the offset before first paint — no layout engine sticky resolution required. This is the most reliable Chrome iOS WKWebView pattern.

### Changes

1. **`src/components/mobile-shell.tsx`**
   - Change header from `sticky top-0` → `fixed top-0 inset-x-0`.
   - Export a sibling `MobileTopBarSpacer` component: `<div className="h-16 lg:hidden" aria-hidden />` that reserves vertical space in the flow.

2. **`src/routes/_authenticated.tsx`**
   - Render `<MobileTopBarSpacer />` immediately after `<MobileTopBar />` and before `<AppSidebar />` / `<main>`.
   - Remove the `mt-20 lg:mt-0` workaround from `<main>` (the spacer now handles offset, and `mt-20` was 80px for a 64px header — slightly over-compensating). Keep `paddingBottom: env(safe-area-inset-bottom)`.

3. **`src/routes/_authenticated/home.tsx`**
   - Remove the `pt-4` extra padding on the "Major Season" heading wrapper that was added as part of the buffer workaround. Heading stays (it's good content), but no compensation padding needed.
   - Remove the duplicate `window.scrollTo` `useEffect` (was a workaround attempt, now redundant).

4. **`src/styles.css`** — no changes. The previous fixes (`overflow-x: hidden` on `html`, fade-only `animate-reveal`) stay; they're independently correct.

5. **`src/routes/__root.tsx`** — no changes. `maximum-scale=1` viewport meta stays.

### Why this works

- `position: fixed` is resolved by Chrome iOS pre-paint reliably (unlike sticky in a flex column).
- The spacer is a normal block element with intrinsic height — no engine quirk involved.
- Header sits above `<main>` via `z-40`; spacer pushes content down deterministically.
- `lg:hidden` on both header and spacer means desktop layout is unaffected.

### Verification

After change, on Chrome iOS portrait first load:
- First tournament card top should sit ~64px below viewport top with no clipping.
- No horizontal overflow.
- Rotation, reload, and subsequent nav should all match first-load layout.
