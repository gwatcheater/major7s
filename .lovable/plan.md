## Objective
Simplify the blog post hero image on individual post views to a small, centered, fully-visible thumbnail instead of a wide cropped banner.

## Files to change
1. `src/routes/_authenticated/blog.$postId.index.tsx`
2. `src/routes/_authenticated/tournament.$id.blog.$postId.index.tsx`

## Changes
In both files, replace the current hero image wrapper+img with a single centered `<img>` using these exact Tailwind classes:
- `max-w-[280px] sm:max-w-[340px]` — restrict width
- `h-auto` — preserve aspect ratio
- `object-contain` — show full image, no cropping
- `mx-auto block` — center horizontally
- `shadow-sm` — subtle shadow
- `rounded-xl` — rounded corners
- `mb-8` — bottom margin

This removes the previous `max-h` wrapper and `object-cover` cropping entirely.

## Result
Blog post images display as compact, centered thumbnails with the entire graphic visible, on both mobile and desktop.