/**
 * Unrated Demons List (https://udl.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const UDL_CONFIG: GdtplListConfig = {
  source: 'udl',
  displayName: 'UDL',
  baseUrl: process.env.UDL_BASE_URL || 'https://udl.pages.dev',
}

export async function importUdl(report?: ProgressReporter): Promise<void> {
  await importGdtpl(UDL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-udl\.ts$/.test(process.argv[1])
if (isCli) {
  importUdl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
