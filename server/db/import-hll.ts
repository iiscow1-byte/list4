/**
 * Horrible Levels List (https://horriblelevelslist.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const HLL_CONFIG: GdtplListConfig = {
  source: 'hll',
  displayName: 'HLL',
  baseUrl: process.env.HLL_BASE_URL || 'https://horriblelevelslist.pages.dev',
}

export async function importHll(report?: ProgressReporter): Promise<void> {
  await importGdtpl(HLL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-hll\.ts$/.test(process.argv[1])
if (isCli) {
  importHll().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
