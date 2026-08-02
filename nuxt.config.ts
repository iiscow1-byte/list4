export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'All Levels List',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'The All Levels List — a community-ranked database of every level worth playing.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // Almost every page paints level thumbnails from these two hosts, and
        // the first one on the page otherwise waits on DNS + TLS before a byte
        // moves. Opening the connections alongside the fonts costs nothing and
        // takes that wait off the first image.
        { rel: 'preconnect', href: 'https://levelthumbs.prevter.me', crossorigin: '' },
        { rel: 'preconnect', href: 'https://i.ytimg.com', crossorigin: '' },
        {
          // One variable font covering 400–900 rather than four static cuts:
          // fewer requests, and `font-black` (900) finally has a real weight to
          // use — `font-synthesis-weight: none` in main.css means a missing
          // weight silently renders lighter instead of being faked.
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400..900&display=swap',
        },
      ],
    },
  },
  // Server sourcemaps are a large slice of Nitro's build time and are only
  // useful when debugging the production bundle itself.
  sourcemap: { server: false, client: false },
  vite: {
    build: {
      // Every browser this site targets handles modern syntax; transpiling
      // down to an older baseline is pure build cost.
      target: 'esnext',
    },
  },
  routeRules: {
    // These three are identical for every visitor and each reads several
    // tables to build one response. A minute of staleness is invisible, and
    // it takes the work off the hot path for the pages that open first.
    '/api/community': { cache: { maxAge: 60 } },
    '/api/stats': { cache: { maxAge: 60 } },
    '/api/landing': { cache: { maxAge: 60 } },
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    // Serve pre-compressed static assets instead of compressing per request.
    compressPublicAssets: { gzip: true, brotli: true },
    rollupConfig: {
      external: ['node:sqlite'],
    },
    esbuild: {
      options: { target: 'esnext' },
    },
  },
})
