# Add Tournament Context dropdown to /blog/new

Enhance `src/routes/_authenticated/blog.new.tsx` so admins can optionally link a new general blog post to a specific tournament, while preserving the existing "General" (null `tournament_id`) behaviour.

## Scope

- Single file change: `src/routes/_authenticated/blog.new.tsx`.
- No schema, RLS, or migration changes — `blog_posts.tournament_id` is already nullable.
- No change to the tournament-scoped flow at `/tournament/$id/blog/new`.

## Implementation steps

1. **Fetch tournaments** with TanStack Query inside the component:
   - `useQuery({ queryKey: ["tournaments", "for-blog-select"], queryFn: ... })`
   - Query: `supabase.from("tournaments").select("id, name, start_date").order("start_date", { ascending: false })`.

2. **Add local state**: `const [tournamentId, setTournamentId] = useState<string | null>(null)` (default = General).

3. **Add UI field** — a new labeled section above Title:
   - Label: "Tournament Context".
   - Use existing `Select` from `@/components/ui/select` (already in project) for consistency with the design system.
   - First item: `<SelectItem value="__general__">General Blog Post</SelectItem>` (sentinel — Radix Select disallows empty string values).
   - Then map tournaments → `<SelectItem value={t.id}>{t.name} ({new Date(t.start_date).getUTCFullYear()})</SelectItem>`.
   - `onValueChange`: set `tournamentId` to `null` when value is `__general__`, else the UUID.

4. **Update `publish()` insert payload**:
   - Replace hardcoded `tournament_id: null` with `tournament_id: tournamentId`.
   - Image upload path: keep `general/...` when `tournamentId` is null; use `${tournamentId}/...` when set (matches the pattern in tournament-scoped flow).

5. **Redirect behaviour**: unchanged — always navigate to `/blog` after success (per request: "redirect back to the main /blog index").

6. **Loading/empty handling**: while tournaments are loading, show the Select with just the General option enabled; no blocking spinner.

## Out of scope

- No Zod schema (current form uses plain `useState`, not react-hook-form/zod — no validation layer to update).
- No changes to the admin-only guard, image upload, or button styling.
- No changes to `/tournament/$id/blog/new`.

## Verification

- Open `/blog/new` as admin → dropdown shows "General Blog Post" first, then tournaments newest-first as `Name (YYYY)`.
- Publish with General selected → row inserted with `tournament_id = null`, redirected to `/blog`.
- Publish with a tournament selected → row inserted with that `tournament_id`, redirected to `/blog`, and post also appears in that tournament hub's Blog collapsible.
