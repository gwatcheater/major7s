## Objective
Add a destructive "Delete Post" action to the existing blog post editing flow in both the general and tournament-scoped edit pages.

## Scope
1. `src/routes/_authenticated/blog.$postId.edit.tsx` — general blog post editor.
2. `src/routes/_authenticated/tournament.$id.blog.$postId.edit.tsx` — tournament-scoped blog post editor.

## Plan

### 1. Add destructive delete button
In the bottom action row of each edit form (currently holds "Save Changes" + "Cancel"), append a third button styled with the existing destructive variant (`bg-destructive` / `text-destructive-foreground` via the `Button` component's `destructive` variant). This places the button directly in the form alongside the existing controls.

### 2. Confirmation dialog
Use the existing `AlertDialog` component (`src/components/ui/alert-dialog.tsx`) already in the project:
- Triggered on clicking "Delete Post".
- Title: "Are you sure?"
- Description: "Are you sure you want to delete this blog post? This action cannot be undone."
- Actions: "Cancel" (outline) + "Delete" (destructive).

### 3. Delete mutation
On confirm, call:
```ts
await supabase.from("blog_posts").delete().eq("id", postId);
```
Handle errors with `toast.error(...)`.

### 4. Post-delete redirect & cache invalidation
- On success, invalidate the relevant query keys (`blog_posts_all`, `blog_posts`, `blog_post`) and toast a success message.
- Redirect the user away from the stale edit page:
  - General edit → `/blog`
  - Tournament edit → `/tournament/$id`

## Out of scope
- No changes to RLS policies or schemas.
- No changes to the list view.
- No changes to the creation flow.
