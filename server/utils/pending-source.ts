/**
 * What makes a pending level an import rather than a submission.
 *
 * A row in `pending_levels` gets there one of two ways: somebody filled in the
 * submit form, or an importer mirrored it from another list. There is no column
 * saying which — it is inferred from *which* importer's marker is set — so the
 * definition is a list of columns, and the list has to be identical everywhere
 * it is used.
 *
 * It was written out once in the review queue, with a comment warning that
 * every importer's marker must appear in both branches: miss one and its rows
 * vanish from the imported queue and simultaneously turn up in the submissions
 * queue, because "not from any importer" is how that side is defined. That
 * comment describes a bug the challenge sheet actually hit. Now that the
 * statistics count the two apart as well, a second copy would be a second
 * chance to make it — so there is one.
 *
 * **Adding an importer means adding its column here.** Nothing else.
 */
const IMPORT_MARKERS = [
  'from_gdl_id IS NOT NULL',
  'from_gdtpl_id IS NOT NULL',
  'from_acs_id IS NOT NULL',
  'from_sheet_pending = 1',
] as const

/**
 * SQL that is true for an imported row.
 *
 * `alias` is the table alias in the caller's query — `p` in the review queue,
 * nothing in a bare `FROM pending_levels`.
 */
export function importedPendingSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : ''
  return `(${IMPORT_MARKERS.map((m) => prefix + m).join(' OR ')})`
}

/** …and its complement, which is what "submitted by a person" means. */
export function submittedPendingSql(alias = ''): string {
  return `NOT ${importedPendingSql(alias)}`
}
