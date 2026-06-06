## Problem
The tournament-scoped blog creation page already exists at `/tournament/$id/blog/new` but there is no UI entry point on the tournament hub. Admins must type the URL manually.

## Solution
Add a single-file UI entry point to `src/routes/_authenticated/tournament.$id.tsx`.

### Changes to `src/routes/_authenticated/tournament.$id.tsx`

1. **Import additions**
   - Add `Plus` to the `lucide-react` import list.
   - Add `import { Button } from "@/components/ui/button";`.

2. **Destructuring**
   - From the existing `useAuth()` call, also destructure `isAdmin` (currently only `user` is pulled).

3. **"+ New Post" button inside Blog `<CollapsibleContent>`**
   - Above the existing post list (around line 298), conditionally render when `isAdmin` is true.
   - Use the existing `<Button asChild>` component wrapping a `<Link to="/tournament/$id/blog/new" params={{ id }}>`.
   - Visual: match existing list-item rhythm — flex row with `Plus` icon left, "New Post" label, and `ChevronRight` on the right, inside a bordered row with `hover:bg-accent`.
   - Render this button **regardless of** `blogPosts.length` (empty or non-empty) so admins can always create a post.

### No other changes
- Do not modify the general `/blog` page or its button.
- Do not alter `blog_posts` schema, RLS, or storage — all infrastructure is already functional.

### Verification steps
1. As admin: open any tournament hub → expand Blog → click "+ New Post" → confirm form loads → publish → confirm redirect to tournament hub and new post appears in list with correct `tournament_id`.
2. As non-admin: confirm the button is not rendered.
3. Verify existing blog post listing behavior is unchanged for both roles.