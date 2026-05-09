/**
 * CCL — Consistency Challenge List (https://consistencychallenge.pages.dev) —
 * a list built on the GDListTemplate format. Thin wrapper over the generic
 * gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'

export const CCL_CONFIG: GdtplListConfig = {
  source: 'ccl',
  displayName: 'CCL',
  baseUrl: process.env.CCL_BASE_URL || 'https://consistencychallenge.pages.dev',
}

export async function importCcl(): Promise<void> {
  await importGdtpl(CCL_CONFIG)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-ccl\.ts$/.test(process.argv[1])
if (isCli) {
  importCcl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
