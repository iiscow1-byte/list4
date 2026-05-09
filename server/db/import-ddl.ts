/**
 * DDL — Denouement Demon List (https://denouementdl.vercel.app) —
 * a list built on the GDListTemplate format. Thin wrapper over the generic
 * gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'

export const DDL_CONFIG: GdtplListConfig = {
  source: 'ddl',
  displayName: 'DDL',
  baseUrl: process.env.DDL_BASE_URL || 'https://denouementdl.vercel.app',
}

export async function importDdl(): Promise<void> {
  await importGdtpl(DDL_CONFIG)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-ddl\.ts$/.test(process.argv[1])
if (isCli) {
  importDdl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
