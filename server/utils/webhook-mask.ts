/**
 * A Discord webhook URL, shown without the part that makes it work.
 *
 * The trailing segment is a write credential for the channel: anyone holding it
 * can post as the webhook. The id in front of it is enough to tell two hooks
 * apart in a list, which is all the UI ever needs. The admin panel used to
 * return and render the whole thing, so every admin page load put a live
 * credential in a browser cache and in whatever tab was open behind it.
 */
export function maskWebhookUrl(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\//)
  return m ? `discord.com/api/webhooks/${m[1]}/…` : 'discord webhook'
}
