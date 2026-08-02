/**
 * SFL — Straight Fly List (https://straightfly.pages.dev) — a list built on
 * the GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const SFL_CONFIG: GdtplListConfig = {
  source: 'sfl',
  displayName: 'SFL',
  baseUrl: process.env.SFL_BASE_URL || 'https://straightfly.pages.dev',
}

export async function importSfl(report?: ProgressReporter): Promise<void> {
  await importGdtpl(SFL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-sfl\.ts$/.test(process.argv[1])
if (isCli) {
  importSfl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
