// Local proxy for boomlings.com — run on a machine whose IP/UA Cloudflare
// allows through (your laptop). Expose to the public app via Cloudflare
// Tunnel: `cloudflared tunnel --url http://localhost:8787`.
//
// Run:
//   PROXY_TOKEN=<random-string> node worker/local-proxy.js
//
// Then on Railway:
//   GD_PROXY_URL=https://<random>.trycloudflare.com
//   GD_PROXY_TOKEN=<the same random-string>

const http = require('node:http')

const PORT = Number(process.env.PORT) || 8787
const TOKEN = process.env.PROXY_TOKEN
if (!TOKEN) {
  console.error('PROXY_TOKEN env var required')
  process.exit(1)
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed')
    return
  }
  if (req.headers['x-proxy-token'] !== TOKEN) {
    res.writeHead(401).end('unauthorized')
    return
  }
  if (!/^\/database\/[A-Za-z0-9_]+\.php$/.test(req.url || '')) {
    res.writeHead(403).end('forbidden path')
    return
  }

  let body = ''
  req.setEncoding('utf8')
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const upstream = http.request(
      {
        method: 'POST',
        host: 'www.boomlings.com',
        port: 80,
        path: req.url,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': body.length,
        },
        timeout: 8000,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, { 'Content-Type': 'text/plain' })
        up.pipe(res)
      },
    )
    upstream.on('error', (e) => {
      res.writeHead(502).end(`upstream error: ${e.message}`)
    })
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
    upstream.end(body)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`boomlings proxy listening on http://127.0.0.1:${PORT}`)
})
