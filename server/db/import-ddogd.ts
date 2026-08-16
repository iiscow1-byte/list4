/**
 * Demons of Death or Glory GD (https://ddogd.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const DDOGD_CONFIG: GdtplListConfig = {
  source: 'ddogd',
  displayName: 'DDOGD',
  baseUrl: process.env.DDOGD_BASE_URL || 'https://ddogd.pages.dev',
}

export async function importDdogd(report?: ProgressReporter): Promise<void> {
  await importGdtpl(DDOGD_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-ddogd\.ts$/.test(process.argv[1])
if (isCli) {
  importDdogd().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
