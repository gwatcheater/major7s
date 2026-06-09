---
name: testing-mobile-layout
description: Test mobile layout CSS changes (scroll behavior, header positioning) using Playwright device emulation against the local TanStack Start dev server.
---

# Testing Mobile Layout — Major7s

## When to Use
Use when verifying CSS changes to the mobile layout shell (`src/styles.css` `.mobile-shell-main`, `.mobile-top-bar`) or the authenticated layout wrapper (`src/routes/_authenticated.tsx`).

## Devin Secrets Needed
- `MAJOR7S_ADMIN_EMAIL` — Admin email for login
- `MAJOR7S_ADMIN_PASSWORD` — Admin password for login

> **Note:** If credentials are invalid, you can still test CSS-only changes by injecting the authenticated layout HTML structure onto any dev server page (CSS is loaded globally via Vite). See "CSS-Injection Approach" below.

## Setup

1. Install dependencies: `npm install`
2. Start dev server: `npm run dev` (runs on `http://localhost:8080`)
3. Install Playwright: `npm install --no-save playwright && npx playwright install chromium`

## Key Layout Architecture

- **`src/styles.css`** — Defines `.mobile-shell-main` (mobile scroll container) and `.mobile-top-bar` (fixed header)
- **`src/routes/_authenticated.tsx`** — `AuthenticatedLayout` component wraps all authenticated pages with `<MobileTopBar />` + `<AppSidebar />` + `<main class="mobile-shell-main">`
- **`src/components/mobile-shell.tsx`** — `MobileTopBar` component (fixed 64px header on mobile)
- Mobile breakpoint: `< 1024px` (Tailwind `lg:` prefix)
- Desktop breakpoint: `>= 1024px`

## CSS-Injection Approach (No Auth Required)

When login credentials are unavailable, inject the authenticated layout HTML structure onto any dev server page:

```js
// Navigate to any page on the dev server (e.g., /login)
// The global CSS is loaded by Vite on all pages
await page.goto('http://localhost:8080/login', { waitUntil: 'networkidle' });

// Replace body with authenticated layout structure
await page.evaluate(() => {
  document.body.innerHTML = `
    <div class="flex flex-col min-h-screen w-full" style="background-color: var(--ui-bg)">
      <header class="mobile-top-bar fixed top-0 inset-x-0 z-50 flex items-center px-4"
              style="background-color: var(--forest-deep)">
        <span class="font-display text-lg text-white">Major7s</span>
      </header>
      <main class="mobile-shell-main flex-1 min-w-0 overflow-x-hidden">
        <div class="p-4"><h1>Test Content</h1></div>
        <!-- Add enough content to make page scrollable -->
      </main>
    </div>`;
});
```

## Test Patterns

### Android Scroll Test
- Use `devices['Pixel 7']` with `hasTouch: true`
- Inject layout, call `window.scrollBy(0, 400)`
- Assert: `window.scrollY > 0` (document scrolls)
- Check CSS: `overscroll-behavior-y` should NOT be `contain` (traps touch events on Android)

### iOS Header Position Test  
- Use `devices['iPhone 14 Pro']` with `hasTouch: true`
- Inject layout, wait 1s for first paint
- Assert: `h1.getBoundingClientRect().top >= header.getBoundingClientRect().bottom`
- Expected: header.bottom ≈ 64px, h1.top ≈ 80px (64px header + 16px padding)

### Before/After CSS Comparison
To prove a fix works, test with both OLD and NEW CSS:
```js
// Apply OLD CSS to show it's broken
main.setAttribute('style', 'height:100dvh!important; overflow-y:auto!important; overscroll-behavior-y:contain!important;');
// ... test scroll ...

// Remove override to use NEW (fixed) CSS
main.removeAttribute('style');
// ... test scroll again ...
```

## Known Limitations
- Headless Chromium does not fully replicate Android's touch-event trapping with `overscroll-behavior-y: contain`. Use CSS property verification as the primary test.
- The `overflow-x-hidden` Tailwind class on `<main>` causes `overflow-y` to compute as `auto` (CSS spec: when one overflow axis is not `visible`, the other defaults to `auto`). This is expected and does not cause scroll-lock as long as the main element's height is not constrained.
- When testing with DevTools docked, the viewport width may exceed 1024px (triggering desktop CSS). Use Playwright device emulation for accurate mobile viewport testing.

## Lint & Build
- Lint: `npm run lint` (ESLint + Prettier — pre-existing formatting errors in stats.tsx and other files are known)
- Build: `npm run build`
- Test: `npm run test` (Vitest)
