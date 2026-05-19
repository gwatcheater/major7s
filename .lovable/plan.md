## Scope

Restyle the bucket-list section of `src/routes/_authenticated/tournament.$id.lineup.tsx` to visually match the Picks card on the tournament detail page. Logic untouched: save flow, OR-matrix `tweakIncrement`, and post-save redirect to `/tournament/$id` all stay as-is.

## Data additions

Add a small `profile` query (same shape used by `tournament.$id.tsx`):
```ts
const { data: profile } = useQuery({
  queryKey: ["profile", "lineup"],
  queryFn: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("profiles")
      .select("team_nickname, nickname").eq("id", user.id).maybeSingle();
    return data;
  },
});
const teamHandle = profile?.team_nickname || activeTeam?.nickname || profile?.nickname || "Your Team";
```

Compute live tweaks preview off current selections:
```ts
const hasChanges = [1,2,3,4,5,6,7].some(b =>
  existingByBucket.get(b)?.golfer_id !== selections[b]);
const liveTweaks = maxTweaks + (hasSubmission && hasChanges ? 1 : 0);
```
Render `Tweaks: {liveTweaks}` so the count bumps the instant a dropdown changes.

## Markup replacement (replaces lines 178–212)

Wrap the bucket list in a shadcn `Card` (matches detail page). Header block:
- Row 1: `font-display uppercase text-base` team handle + green `CheckCircle2` (when `hasSubmission`).
- Row 2: muted `text-xs` "Tweaks: {liveTweaks}".

List: `divide-y divide-border border border-border` containing 7 rows. Each row:
```
<div className="flex items-center justify-between px-4 py-3 gap-4">
  <span className="text-xs uppercase tracking-widest text-muted-foreground">Bucket {b}</span>
  <select className="text-sm font-medium text-right bg-transparent border-0 focus:outline-none focus:ring-0 max-w-[60%] truncate disabled:opacity-50 cursor-pointer">
    <option value="">— Select —</option>
    {opts.map(g => <option ...>{g.golfer_name}{g.owgr_rank ? ` (OWGR #${g.owgr_rank})` : ""}</option>)}
  </select>
</div>
```
- Borderless, right-aligned select to mimic the static golfer name rows.
- Unselected rows: subtle left accent via inline style `borderLeftWidth: 3, borderLeftColor: var(--alert)` to keep the warning hint.
- Disabled state when `isLocked || opts.length === 0`.

Save button: keep current "Save Lineup" `<button>` styling, mounted directly below the card.

## Removed

- Old bulky per-row `bg-card border p-4` containers.
- The header `Tweaks · {maxTweaks}` chip in the page header (now superseded by the inline Tweaks line inside the new card — keeps a single source of truth).

## Untouched

- `BUCKET_LABELS`, `byBucket` filtering & sort, `Countdown`, locked banner, empty-field empty-state.
- `save()`: validation, OR-matrix `hasChanges`/`tweakIncrement`, upsert loop, query invalidations, and `navigate({ to: "/tournament/$id", params: { id } })` redirect.

No new files. No DB or schema changes.