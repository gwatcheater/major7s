## Objective
Cap the blog post hero image height on individual post views so it acts as an accent banner rather than dominating the viewport.

## Files to change
1. `src/routes/_authenticated/blog.$postId.index.tsx`
2. `src/routes/_authenticated/tournament.$id.blog.$postId.index.tsx`

## Changes
In both files, update the `post.image_url` conditional block:
- Wrap the `<img>` in a `<div>` with `className="w-full overflow-hidden rounded-md border border-border mb-6"`.
- Update the `<img>` classes to `w-full h-full object-cover object-center`.
- Add a max-height constraint to the wrapper: `max-h-[350px] sm:max-h-[400px]`.

## Result
Portrait or oversized images will center-crop into a cinematic widescreen banner (~350–400 px tall) while maintaining the existing border, rounded corners, and bottom margin for clean separation from the heading and content.