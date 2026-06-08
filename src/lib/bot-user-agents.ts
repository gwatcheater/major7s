// Single source of truth for detecting link-unfurl scrapers.
// Used by the public blog post route to decide whether to return
// OG-only HTML or render the normal app.
const BOT_UA_PATTERN =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|WhatsApp|Discordbot|TelegramBot|Pinterest|redditbot|Applebot|SkypeUriPreview|vkShare|W3C_Validator|Googlebot|bingbot|DuckDuckBot|embedly|quora link preview|Iframely|Mastodon|nuzzel/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA_PATTERN.test(ua);
}
