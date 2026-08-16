/**
 * BR List (https://br-list.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const BRL_CONFIG: GdtplListConfig = {
  source: 'brl',
  displayName: 'BR',
  baseUrl: process.env.BRL_BASE_URL || 'https://br-list.pages.dev',
}

export async function importBrl(report?: ProgressReporter): Promise<void> {
  await importGdtpl(BRL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-brl\.ts$/.test(process.argv[1])
if (isCli) {
  importBrl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
