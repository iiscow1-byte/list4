/**
 * The admin panel's sections: what each is called, its icon, one line on what
 * it is for, who can open it, and which group it sits in.
 *
 * One table, read by the sidebar, the Overview's cards and each section's own
 * heading, so the three can never call the same place by different names.
 *
 * ## Who sees what
 *
 * `helper` is an allow-list rather than a level: a list helper sees exactly the
 * sections marked for them and nothing else, so a section added later is closed
 * to helpers until somebody deliberately opens it. That is the safe default for
 * a role whose entire point is being narrow.
 *
 * None of it is enforcement. Every endpoint behind these sections checks the
 * role itself; this only decides what is worth rendering.
 */
export type AdminTabId =
  | 'overview'
  | 'records' | 'opinions' | 'levels' | 'imported-levels' | 'awaiting' | 'movements' | 'imported-movements'
  | 'open-verifications' | 'reports' | 'helper-requests'
  | 'statistics' | 'log'
  | 'accounts' | 'claims' | 'custom-lists' | 'imports' | 'discord'

export type AdminAudience = 'helper' | 'staff' | 'admin'

export type AdminSectionMeta = {
  id: AdminTabId
  label: string
  icon: string
  blurb: string
  audience: AdminAudience
  /** Has a count of things waiting, shown in the sidebar and on the Overview. */
  queue?: boolean
}

export const ADMIN_SECTIONS: AdminSectionMeta[] = [
  { id: 'overview', label: 'Overview', icon: 'home', audience: 'helper',
    blurb: 'What is waiting, and the site’s switches.' },

  // Placing levels, deciding level submissions and deciding records is the
  // whole of the list helper role.
  { id: 'levels', label: 'Level submissions', icon: 'level', audience: 'helper', queue: true,
    blurb: 'Levels people have submitted to the list.' },
  { id: 'awaiting', label: 'Awaiting placement', icon: 'hourglass', audience: 'helper', queue: true,
    blurb: 'Approved levels waiting for a place on the list.' },
  { id: 'records', label: 'Records', icon: 'record', audience: 'helper', queue: true,
    blurb: 'Completions waiting for someone to check the video.' },
  { id: 'imported-levels', label: 'Imported levels', icon: 'download', audience: 'staff', queue: true,
    blurb: 'Levels other lists have that this one doesn’t.' },
  { id: 'movements', label: 'Move requests', icon: 'move', audience: 'staff', queue: true,
    blurb: 'Requests to move a level up or down.' },
  { id: 'imported-movements', label: 'Imported moves', icon: 'layers', audience: 'staff', queue: true,
    blurb: 'Where another list orders shared levels differently.' },
  { id: 'opinions', label: 'Opinions', icon: 'opinion', audience: 'staff', queue: true,
    blurb: 'Difficulty and enjoyment ratings.' },

  { id: 'reports', label: 'Reports', icon: 'flag', audience: 'staff', queue: true,
    blurb: 'Things people have flagged.' },
  { id: 'open-verifications', label: 'Open verifications', icon: 'verify', audience: 'staff', queue: true,
    blurb: 'Unverified levels submitted to the open verification list.' },
  // Applying a helper's request is an admin decision by definition: the point
  // of the request is that a helper could not do it themselves.
  { id: 'helper-requests', label: 'Helper requests', icon: 'helper', audience: 'admin', queue: true,
    blurb: 'Changes list helpers have asked an admin to make.' },

  { id: 'statistics', label: 'Statistics', icon: 'chart', audience: 'staff',
    blurb: 'Traffic, and what the site gained.' },
  { id: 'log', label: 'Activity log', icon: 'activity', audience: 'admin',
    blurb: 'Everything staff have done, with undo.' },

  { id: 'accounts', label: 'Accounts', icon: 'users', audience: 'admin',
    blurb: 'Roles, bans and player claims.' },
  { id: 'claims', label: 'Claims', icon: 'link', audience: 'admin', queue: true,
    blurb: 'People asking to be recognised as a player on the list.' },
  { id: 'custom-lists', label: 'Custom lists', icon: 'list', audience: 'admin',
    blurb: 'Lists people have built, and building one from an imported list.' },
  { id: 'imports', label: 'Imports', icon: 'sheet', audience: 'admin',
    blurb: 'Re-run importers, back up placements, compare with the sheet.' },
  { id: 'discord', label: 'Discord', icon: 'bell', audience: 'admin',
    blurb: 'Channels the site posts to.' },
]

/** Grouped by what you came to do, which is how somebody arrives at the panel. */
export const ADMIN_GROUPS: { key: string; label: string; ids: AdminTabId[] }[] = [
  { key: 'start', label: '', ids: ['overview'] },
  { key: 'queues', label: 'Review', ids: ['levels', 'awaiting', 'records', 'imported-levels', 'movements', 'imported-movements', 'opinions'] },
  { key: 'moderation', label: 'Moderation', ids: ['reports', 'open-verifications', 'helper-requests', 'claims'] },
  { key: 'insight', label: 'Insight', ids: ['statistics', 'log'] },
  { key: 'manage', label: 'Settings', ids: ['accounts', 'custom-lists', 'imports', 'discord'] },
]

export function adminSection(id: string): AdminSectionMeta | undefined {
  return ADMIN_SECTIONS.find((s) => s.id === id)
}

/** The sections a role can open. */
export function sectionsFor(role: string | null | undefined): AdminSectionMeta[] {
  const isAdmin = role === 'admin' || role === 'owner' || role === 'developer'
  const isHelper = role === 'list_helper'
  return ADMIN_SECTIONS.filter((s) => {
    if (isHelper) return s.audience === 'helper'
    if (isAdmin) return true
    return s.audience !== 'admin'
  })
}
