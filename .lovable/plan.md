## Fix duplicate subject in Gmail mobile snippets

Both templates set `<Preview>` to the exact same string as the subject, which causes Gmail mobile to render the subject twice (once as subject, once as snippet). Replace each `<Preview>` with distinct, complementary text using existing template props. No subject or visible body changes.

### 1. `src/lib/email-templates/picks-confirmation.tsx`

Replace:
```tsx
<Preview>{`Picks confirmed - ${name}${yr ? ` ${yr}` : ''}`}</Preview>
```
with:
```tsx
<Preview>{`Your ${name}${yr ? ` ${yr}` : ''} lineup is locked in${team && team !== 'Your team' ? ` - ${team}` : ''}.`}</Preview>
```
- Uses already-resolved `name` (shortName), `yr`, and `team` (teamNickname) variables that are computed just above the return.
- Example output: `Your The Open 2026 lineup is locked in - Birdie Bandits.`
- Falls back gracefully when team nickname missing (drops the `- {team}` segment).

### 2. `src/lib/email-templates/admin-new-user.tsx`

Replace:
```tsx
<Preview>{`New Major7s signup: ${nickname || fullName || email || 'unknown'}`}</Preview>
```
with:
```tsx
<Preview>{`${fullName || nickname || email || 'A new player'} just signed up${referralName ? ` (referred by ${referralName})` : ''}.`}</Preview>
```
- Example output: `Test Player just signed up (referred by Rob Parker).`
- Drops the referral segment cleanly when absent.

### Position check
Both `<Preview>` tags are already the first child of `<Html>` (immediately after `<Head />`, before `<Body>`) — React Email injects them as the first hidden text node in the rendered body, which is exactly what Gmail uses as the snippet. No structural change needed.

### Verification after publish
1. Re-run `sendPicksConfirmationTest` to rob@rjparker.co.uk and confirm Gmail mobile snippet reads the new preheader, not the subject.
2. Trigger (or wait for) an admin-new-user send; confirm the snippet differs from the subject.
3. Report the exact rendered preheader strings in the next message.

### Out of scope
- No subject changes.
- No visible body copy changes.
- No layout, styling, or data-build changes.