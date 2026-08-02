/**
 * EDI (https://edi-d6y.pages.dev) — a list built on the GDListTemplate format.
 * Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const EDI_CONFIG: GdtplListConfig = {
  source: 'edi',
  displayName: 'EDI',
  baseUrl: process.env.EDI_BASE_URL || 'https://edi-d6y.pages.dev',
}

export async function importEdi(report?: ProgressReporter): Promise<void> {
  await importGdtpl(EDI_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-edi\.ts$/.test(process.argv[1])
if (isCli) {
  importEdi().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
