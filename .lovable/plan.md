## Scope

Small UI-only edit to `src/routes/_authenticated/tournament.$id.lineup.tsx`. Save/tweak logic and post-save redirect to `/tournament/$id` are already in place — leave them untouched.

## Changes (lines 184–198)

1. **Remove the `B{b}` shorthand element.** Delete `<div className="font-display text-xs text-muted-foreground">B{b}</div>` so only the `Bucket [N]` label remains (sourced from `BUCKET_LABELS[b]`, already `"Bucket 1"` … `"Bucket 7"`).

2. **Row layout**: change each bucket row to label-left on desktop, label-above on mobile.
   - Outer wrapper: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4`.
   - Label: bump to high-contrast typography — `font-bold text-sm text-foreground` (drop the `text-muted-foreground` shorthand entirely). Keep red left-border accent when unselected.
   - Select stays full-width on mobile, `sm:w-[300px]` on desktop.

3. **Option text format**: change `"{golfer_name} (#{rank})"` to `"{golfer_name} (OWGR #{rank})"` when rank exists; unchanged when rank is null.

## Untouched

- `BUCKET_LABELS` constant (already `"Bucket N"`).
- `byBucket` filtering — already scopes options to that bucket id.
- 7-way OR `tweakIncrement` comparison.
- `save()` → upsert + `navigate({ to: "/tournament/$id", params: { id } })` post-save redirect.

No other files modified.