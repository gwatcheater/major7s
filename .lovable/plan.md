## Plan: stop the trial-and-error and fix Chrome iOS safely

### Goal
Make `/home` first load correctly on Chrome iOS portrait, with the mobile header visible and the “Major Season” heading + first tournament card starting below it.

### Approach
1. **Rollback the risky layout experiments**
   - Revert the recent fixed-header / isolated-scroll-container changes that made the issue worse.
   - Return to the simpler mobile shell structure that was closest to the original working layout.

2. **Remove likely Chrome iOS triggers**
   - Remove first-load card reveal animation from the tournament list on mobile.
   - Avoid changing scroll containers or using repeated forced scroll resets.
   - Keep the page using normal document scrolling, which is generally more reliable on iOS Chrome.

3. **Use a conservative header offset**
   - Keep the mobile top bar as a normal sticky header.
   - Add a plain, static top padding/margin only where the `/home` content begins if needed.
   - Avoid `100dvh`, custom mobile scroll areas, and complex safe-area calculations unless strictly required.

4. **Add Chrome iOS-specific defensive CSS only if necessary**
   - Use feature queries / mobile media queries to target mobile WebKit behavior.
   - Keep the fix local to the authenticated shell and home page.

5. **Verify the outcome by checking layout state**
   - Confirm the first visible content on `/home` is the “Major Season” heading below the top bar.
   - Confirm the first tournament card is not underneath the header.
   - Confirm desktop layout is unchanged.

### Technical notes
- Files likely involved:
  - `src/components/mobile-shell.tsx`
  - `src/routes/_authenticated.tsx`
  - `src/routes/_authenticated/home.tsx`
  - `src/styles.css`
- I will not edit generated files.
- I will not add more scroll-reset loops unless there is direct evidence they are needed.

### Fallback if this still fails
If Chrome iOS still preserves a bad first-paint position after the rollback-first fix, the next step should be a user-assisted repro signal: one fresh screenshot plus exact browser state after login. At that point it may be faster to restore a known earlier version from History and reapply unrelated changes incrementally.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>