## Goal

Make Major7s render and behave correctly on phones (iOS/Android), tablets, and desktop, with a hamburger + slide-in drawer on mobile, mobile-friendly layouts across all user-facing routes, and a "use desktop" notice on admin routes below the `md` breakpoint.

## Approach

### 1. Responsive shell (root layout)

- Convert `src/routes/__root.tsx` (or the `_authenticated` layout — wherever `AppSidebar` is currently mounted) into a responsive shell:
  - **Desktop (≥ md):** current fixed sidebar (`w-72`) + content, unchanged.
  - **Mobile (< md):** hide the sidebar; render a sticky top bar with the Major7s wordmark, a hamburger button, and the user avatar. Tapping the hamburger opens the existing sidebar inside a shadcn `Sheet` (slide-in from left), reusing `AppSidebar` content verbatim so team switcher, nav, admin link, and sign-out all work.
- Add a `useIsMobile` check (already in `src/hooks/use-mobile.tsx`) to switch between the two shells.
- Close the drawer on route change (listen to `useRouterState` location).
- Ensure body/main uses `min-h-dvh` and safe-area padding (`pb-[env(safe-area-inset-bottom)]`) so iOS notch/home-indicator don't clip content.

### 2. Global responsive primitives

- In `src/styles.css`: confirm `html { -webkit-text-size-adjust: 100%; }` and set base font-size that scales (`clamp(...)` for display headings). Add `@media (max-width: 768px)` adjustments where headings currently use very large desktop sizes.
- Ensure all page wrappers use `px-4 md:px-8`, replace hard `w-[...px]` with `w-full max-w-...`, and audit horizontal overflow (`overflow-x-hidden` on `main`).
- Make all tables responsive: wrap in `overflow-x-auto` containers; on key tables convert to stacked cards under `md` (see per-route notes).

### 3. Per-route updates

**`/home` (Live & Upcoming):** stack hero/cards single-column on mobile; tournament card grid → 1 col mobile, 2 col tablet, 3 col desktop.

**`/tournament/$id`:** header (name, course, dates, countdown) stacks vertically; tabs/sub-nav become horizontally scrollable; field list → card view on mobile.

**`/tournament/$id/lineup` (lineup builder):**
- Tier rows: dropdowns currently sized equal-to-largest — on mobile they wrap to full-width per bucket.
- "ENTER LINEUP" / submit CTA becomes a sticky bottom bar on mobile so it's reachable while scrolling.
- Make sure tap targets are ≥ 44px (iOS HIG).

**`/archive`, `/stats`, `/hall-of-fame`:** tables → mobile card layout (label/value pairs) under `md`.

**`/profile`:** tab buttons (Personal Info / Account Security) become a horizontal scroll strip on mobile; form fields stack full-width; Save button sticks to bottom on mobile.

**`/login`, `/reset-password`:** centered card already; tighten padding, ensure inputs are `text-base` (prevents iOS zoom on focus when < 16px).

### 4. Admin routes — desktop-only

- In `src/routes/_authenticated/admin.*.tsx` (or a shared `admin` layout wrapper), render a full-screen notice when viewport width is `< md`:
  - Friendly card: "Admin tools require a desktop screen. Please switch to a larger device to manage tournaments, users, and picks."
  - Keep navigation back to `/home` available.
- Use a CSS-only approach (`hidden md:block` for admin content, `md:hidden` for the notice) so SSR works without a JS flicker.

### 5. Touch & a11y polish

- All buttons/links min-height 40–44px on mobile.
- Inputs `text-base` minimum on mobile.
- Sidebar drawer: focus trap (Sheet handles this), Esc to close, backdrop dismiss.
- Add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` in root head (verify it's already there; add `viewport-fit=cover` for safe-area support).

### 6. Verification

- Use the preview at 375×812 (iPhone), 390×844, 414×896, 768×1024 (iPad), 1280×800, 1920×1080.
- Walk: login → home → tournament → lineup → submit → profile → admin (mobile shows notice; desktop works).
- Screenshot each viewport on key routes; fix any overflow, clipped CTA, or unreadable text.

## Technical details

- New file: `src/components/mobile-shell.tsx` — sticky top bar + Sheet wrapping `AppSidebar`.
- New file: `src/components/admin-desktop-only.tsx` — the "use desktop" notice card; wrap admin route components with it.
- Edited: root/`_authenticated` layout to branch on `useIsMobile()`.
- Edited: each route file listed above for responsive class adjustments — no business logic changes.
- Edited: `src/styles.css` for type scale, safe-area utility, base mobile tweaks.
- Edited: `src/components/app-sidebar.tsx` — make root element work both as fixed desktop aside and as Sheet content (drop `sticky top-0 h-screen` styling when rendered inside Sheet via a prop).

No DB, RLS, server function, or business logic changes.
