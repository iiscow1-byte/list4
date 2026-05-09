/**
 * LL — Laylist (https://laylist.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'

export const LL_CONFIG: GdtplListConfig = {
  source: 'll',
  displayName: 'LL',
  baseUrl: process.env.LL_BASE_URL || 'https://laylist.pages.dev',
}

export async function importLl(): Promise<void> {
  await importGdtpl(LL_CONFIG)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-ll\.ts$/.test(process.argv[1])
if (isCli) {
  importLl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
