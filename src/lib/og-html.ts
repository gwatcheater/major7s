// Minimal OG-only HTML response for link-unfurl scrapers.
// Kept as a string template (no React renderToString) so the bot path
// stays tiny and dependency-free.

export interface OgMeta {
  title: string;
  description: string;
  imageUrl: string;
  absoluteUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOgHtml(meta: OgMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const imageUrl = escapeHtml(meta.imageUrl);
  const absoluteUrl = escapeHtml(meta.absoluteUrl);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Major7s">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${absoluteUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${imageUrl}">
<link rel="canonical" href="${absoluteUrl}">
</head><body><p>${title}</p></body></html>`;
}
