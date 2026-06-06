## Branding Update Plan

Use the attached `major7s.jpeg` (golf flag/ball logo) as the source for both favicon and Apple touch icon.

### 1. Add image assets to `public/`
- Generate `public/faviconf.ico` from the uploaded image (resized/converted via ImageMagick).
- Generate `public/apple-touch-icon.png` from the uploaded image (180x180 PNG).

### 2. Update `src/routes/__root.tsx` head

**Meta updates:**
- `description`: `"Pick smart. Tweak obsessively. Suffer beautifully. Major7s is the ultimate golf picks game across all four majors."`
- `og:description` and `twitter:description`: same as above
- `og:title` / `twitter:title`: keep `"Major7s"`
- `og:type`: keep `"website"`
- `og:image` / `twitter:image`: `https://www.major7s.com/apple-touch-icon.png` (absolute URL, project's custom domain)

**Links additions:**
- `{ rel: "icon", href: "/faviconf.ico", type: "image/x-icon" }`
- `{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" }`

### Notes
- Files placed in `public/` are served from the site root, matching the requested URLs.
- Using `https://www.major7s.com` (the project's custom domain) for absolute OG image URL so WhatsApp/social previews work.
- The existing R2 og:image URL will be replaced with the new apple-touch-icon URL.
