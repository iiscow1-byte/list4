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
        // Tints the browser chrome on mobile to match the site rather than
        // leaving a white bar above a black page.
        { name: 'theme-color', content: '#0a0a0a' },
      ],
      link: [
        // The tab icon is the real logo, cut down to size.
        //
        // `public/logo.png` is the 512px artwork and stays the source of truth;
        // `scripts/make-icons.mjs` reduces it to these two, which are committed.
        // Pointing a tab straight at the 512 works and ships 350 KB to paint
        // sixteen pixels, which is not what this site does elsewhere.
        //
        // No `mask-icon` here: Safari silhouettes that into one flat shape, and
        // the logo is a photographic collage with no meaningful silhouette — it
        // would pin as a solid black square. Safari falls back to the icon
        // below, which is the better answer.
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icon-32.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/icon-180.png' },
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
    // The forum and the friends list are sections of pages now rather than
    // pages of their own — see `utils/site-nav.ts` for why. These keep any
    // link that was made while they were top-level working.
    '/forum': { redirect: '/community?tab=forum' },
    '/forum/**': { redirect: '/community?tab=forum' },
    '/friends': { redirect: '/account?panel=friends' },

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
