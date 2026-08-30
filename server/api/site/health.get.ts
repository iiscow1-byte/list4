/**
 * Liveness, and nothing else.
 *
 * The platform health check needs a path that answers 200 whenever the process
 * is up. It used to probe `/`, which is a page — so it went through the
 * lockdown middleware, and a site closed to the public answers `/` with a 302
 * to `/login`. Closing the site therefore risked the deploy being marked
 * unhealthy and restarted, which is the one moment you least want the site
 * restarting. Worse, the closed flag lives in the database now, so a restart
 * read it back and failed again.
 *
 * Deliberately touches nothing: no database, no session, no imports. It answers
 * "this process is listening", which is the only question a health check asks.
 * Anything richer would let a slow query or a stale row take the site down.
 */
export default defineEventHandler(() => ({ ok: true }))
