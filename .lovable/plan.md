## Plan: Blog post views + likes migration

Run the provided SQL as a single Lovable Cloud migration (one migration call, wrapped in the tool's transaction).

### What it does
- Adds `views_count` and `likes_count` (int, default 0) to `public.blog_posts`.
- Creates `public.blog_post_views` (post_id, user_id, viewed_at) — PK (post_id, user_id).
- Creates `public.blog_post_likes` (post_id, user_id, liked_at) — PK (post_id, user_id).
- Enables RLS on both new tables with `auth.uid() = user_id` policies (select/insert on views; select/insert/delete on likes).
- Grants `authenticated` the required privileges; `service_role` gets `ALL` (added for consistency with project conventions).
- Adds `SECURITY DEFINER` trigger functions with pinned `search_path` to increment/decrement counters on insert/delete.

### Adjustments to your SQL
- Strip the `begin;`/`commit;` — the migration tool wraps the statements itself.
- Add `GRANT ALL ON public.blog_post_views TO service_role;` and same for `blog_post_likes` (project convention; needed for admin/edge paths).
- Revoke `EXECUTE` on the three trigger functions from `PUBLIC`/`anon`/`authenticated` (they're `SECURITY DEFINER`; only the trigger context should invoke them) — matches the hardening already applied to other definer functions in the project.
- Everything else is used verbatim.

### After migration runs
- No app code changes in this step. UI wiring for the view tracker and like button is out of scope here — request it separately when ready.

### Verification
- `supabase--linter` to confirm no new warnings.
- Quick `select` on the two new tables to confirm they exist and RLS is on.
