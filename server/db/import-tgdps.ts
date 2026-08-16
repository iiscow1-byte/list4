/**
 * TGDPS Demon List (https://tgdps-dl.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const TGDPS_CONFIG: GdtplListConfig = {
  source: 'tgdps',
  displayName: 'TGDPS',
  baseUrl: process.env.TGDPS_BASE_URL || 'https://tgdps-dl.pages.dev',
}

export async function importTgdps(report?: ProgressReporter): Promise<void> {
  await importGdtpl(TGDPS_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-tgdps\.ts$/.test(process.argv[1])
if (isCli) {
  importTgdps().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
