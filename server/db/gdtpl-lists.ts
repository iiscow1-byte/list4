import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'
import { TSL_CONFIG } from './import-tsl.ts'
import { EDI_CONFIG } from './import-edi.ts'
import { CCL_CONFIG } from './import-ccl.ts'
import { LL_CONFIG } from './import-ll.ts'
import { TCL_CONFIG } from './import-tcl.ts'
import { SFL_CONFIG } from './import-sfl.ts'
import { DDL_CONFIG } from './import-ddl.ts'
import { HLL_CONFIG } from './import-hll.ts'
import { BRL_CONFIG } from './import-brl.ts'
import { UDL_CONFIG } from './import-udl.ts'
import { DDOGD_CONFIG } from './import-ddogd.ts'
import { TGDPS_CONFIG } from './import-tgdps.ts'
import { CSCL_CONFIG } from './import-cscl.ts'
import { GDTPL_LISTS as GDTPL_CATALOG } from '../../utils/list-source-catalog.ts'

/** slug → the config that carries its base URL and env override. */
const CONFIGS: Record<string, GdtplListConfig> = {
  tsl: TSL_CONFIG, edi: EDI_CONFIG, ccl: CCL_CONFIG, ll: LL_CONFIG,
  tcl: TCL_CONFIG, sfl: SFL_CONFIG, ddl: DDL_CONFIG,
  hll: HLL_CONFIG, brl: BRL_CONFIG, udl: UDL_CONFIG,
  ddogd: DDOGD_CONFIG, tgdps: TGDPS_CONFIG, cscl: CSCL_CONFIG,
}

/**
 * Every list the site reads in the GDListTemplate format, in one place.
 *
 * Each of these used to be spelled out separately in four files — the runner
 * map, the pending-clear SQL, the pending-count query and the admin panel's
 * source list — with the slug repeated in a hand-written subquery each time.
 * Thirteen lists across four hand-maintained copies is fifty-two chances to
 * add a list that imports but can never be cleared, or that reports another
 * list's pending count. They are all derived from this array now, so adding a
 * list is one entry here plus its config file.
 *
 * `label` is what the admin panel prints; `blurb` is the one-line description
 * under it. `group` decides which section of the imports tab it lands in.
 */
export type GdtplListEntry = {
  config: GdtplListConfig
  label: string
  blurb: string
  group: 'demon' | 'challenge' | 'community'
}

export const GDTPL_LISTS: GdtplListEntry[] = GDTPL_CATALOG
  .filter((c) => !c.bespoke && CONFIGS[c.slug])
  .map((c) => ({ config: CONFIGS[c.slug]!, label: c.short, blurb: c.blurb, group: c.group }))

/** Slug → entry, for the places that hold only a key. */
export const GDTPL_BY_SLUG = new Map(GDTPL_LISTS.map((l) => [l.config.source, l]))

/** Runner map entries, ready to spread into the imports runner registry. */
export function gdtplRunners(): Record<string, (report: ProgressReporter) => Promise<void>> {
  return Object.fromEntries(
    GDTPL_LISTS.map((l) => [
      l.config.source,
      async (report: ProgressReporter) => { await importGdtpl(l.config, report) },
    ]),
  )
}

/**
 * `pending_levels` rows this list put there and nobody has decided on yet.
 *
 * The slug is interpolated rather than bound because this string is also used
 * to build a COUNT and a DELETE in two different files; it is never caller
 * input — every value comes from the array above — and the assertion keeps it
 * that way if somebody ever wires it to a request.
 */
export function gdtplPendingWhere(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`bad gdtpl slug: ${slug}`)
  return `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = '${slug}')`
}
