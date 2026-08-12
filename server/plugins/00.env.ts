import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Read `.env` when the built server starts.
 *
 * Nuxt loads `.env` during `dev` and during a build, and **not** when you run
 * the output — `node .output/server/index.mjs` starts with whatever is already
 * in the environment and nothing else. Every secret this site has was therefore
 * either exported by hand at the shell or silently absent, which is how the
 * YouTube key came to be missing in production: the endpoint answered "no
 * dates" forever and nothing said why.
 *
 * The alternative is `runtimeConfig`, which reads the value at *build* time and
 * bakes it into `.output`. That works, and it means a secret lives inside a
 * build artefact and rotating a key needs a rebuild. This keeps the key in one
 * file outside the build, where changing it is a restart.
 *
 * `process.loadEnvFile` is Node's own (20.12+), so this costs no dependency.
 * It never overwrites a variable that is already set, so a real environment
 * variable — a systemd unit, a container, `KEY=x node …` — still wins over the
 * file, which is the precedence anyone deploying this would expect.
 */
const CANDIDATES = ['.env', '../.env', '../../.env']

export default defineNitroPlugin(() => {
  const load = (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (typeof load !== 'function') return

  for (const rel of CANDIDATES) {
    const path = resolve(process.cwd(), rel)
    if (!existsSync(path)) continue
    try {
      load.call(process, path)
    } catch {
      // A malformed .env is not a reason to refuse to boot: everything that
      // reads one of these already has a defined behaviour for "unset".
    }
    return
  }
})
