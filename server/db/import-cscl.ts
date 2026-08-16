/**
 * Controlled Spam Challenge List (https://controlledspamchallengelist.pages.dev) — a list built on the
 * GDListTemplate format. Thin wrapper over the generic gdtpl importer.
 */
import { importGdtpl, type GdtplListConfig } from './import-gdtpl.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export const CSCL_CONFIG: GdtplListConfig = {
  source: 'cscl',
  displayName: 'CSCL',
  baseUrl: process.env.CSCL_BASE_URL || 'https://controlledspamchallengelist.pages.dev',
  defaultDifficulty: 'Challenge',
}

export async function importCscl(report?: ProgressReporter): Promise<void> {
  await importGdtpl(CSCL_CONFIG, report)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-cscl\.ts$/.test(process.argv[1])
if (isCli) {
  importCscl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
