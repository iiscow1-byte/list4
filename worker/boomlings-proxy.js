// Cloudflare Worker: proxy POST requests to boomlings.com.
//
// Boomlings 403s requests from Railway/datacenter IPs and from any UA-bearing
// fetch. Cloudflare's egress is generally clean, and we strip the UA before
// forwarding.
//
// Auth: requests must include `X-Proxy-Token` matching the PROXY_TOKEN secret.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }
    if (request.headers.get('x-proxy-token') !== env.PROXY_TOKEN) {
      return new Response('unauthorized', { status: 401 })
    }

    const path = new URL(request.url).pathname
    if (!/^\/database\/[A-Za-z0-9_]+\.php$/.test(path)) {
      return new Response('forbidden path', { status: 403 })
    }

    const body = await request.text()
    const upstream = await fetch(`http://www.boomlings.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
