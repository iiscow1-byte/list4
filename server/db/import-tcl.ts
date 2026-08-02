/**
 * TCL — Tiny Challenge List (https://tinychallengelist.pages.dev) — a list
 * built on the GDListTemplate format. Thin wrapper over the generic gdtpl
 * importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const TCL_CONFIG: GdtplListConfig = {
  source: 'tcl',
  displayName: 'TCL',
  baseUrl: process.env.TCL_BASE_URL || 'https://tinychallengelist.pages.dev',
}

export async function importTcl(report?: ProgressReporter): Promise<void> {
  await importGdtpl(TCL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-tcl\.ts$/.test(process.argv[1])
if (isCli) {
  importTcl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
