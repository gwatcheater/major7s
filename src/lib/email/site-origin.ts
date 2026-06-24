/**
 * Stable, public-facing site origin for URLs embedded in emails or any
 * other channel where the user is not on the request. Never derive a
 * user-facing URL from the inbound request host - that yields preview/
 * localhost origins when sends originate from the editor or dev.
 */
export function getPublicSiteOrigin(): string {
  const fromEnv = (process.env.PUBLIC_SITE_URL ?? '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return 'https://www.major7s.com'
}
