/**
 * The Shitty List Plus (https://tslplus.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 * Adding another GDListTemplate-based list later is the same shape: copy
 * this file, swap the config.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'

export const TSL_CONFIG: GdtplListConfig = {
  source: 'tsl',
  displayName: 'TSL',
  baseUrl: process.env.TSL_BASE_URL || 'https://tslplus.pages.dev',
}

export async function importTsl(): Promise<void> {
  await importGdtpl(TSL_CONFIG)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-tsl\.ts$/.test(process.argv[1])
if (isCli) {
  importTsl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
