/**
 * The ALL sheet, as a reader opens it.
 *
 * Distinct from the URL the importer fetches (`server/db/import.ts`), which is
 * a *published* `/spreadsheets/d/e/2PACX-…` export — that address serves CSV and
 * is useless to a person. This is the document itself, and it is the source of
 * truth the whole site is built from, so it belongs one click away rather than
 * pasted into whichever page happened to need it.
 */
export const ALL_SHEET_ID = '1ZRsTUeX4XRCLMcMbyacbk5dkZv8lild8F0zZNs6DGn4'
export const ALL_SHEET_URL = `https://docs.google.com/spreadsheets/d/${ALL_SHEET_ID}/`
