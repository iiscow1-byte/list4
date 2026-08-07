export type Role = 'user' | 'moderator' | 'admin' | 'owner' | 'developer'
/** Roles held on a custom list rather than on the site. */
export type ListRole = 'list-owner' | 'list-editor'
export type AnyRole = Role | ListRole

/**
 * What each role is, in one place.
 *
 * Two things went wrong with these badges while there were seven copies of
 * them. The geometry drifted — three text sizes and four paddings for the same
 * chip — and, less visibly, **owner and admin were the same colour**: owner was
 * `amber-500` and admin was `accent`, and the site's accent *is* `amber-500`.
 * The two most consequential roles on the site were indistinguishable.
 *
 * `accent` is now used by exactly one badge, the owner of a *custom list*,
 * where following the list's own colour is the point — every list page sets
 * `--c-accent` to the list's colour, so that chip is the list's owner in the
 * list's colour. A site role must never use it: the same badge would change
 * colour depending on which page it was printed on.
 *
 * `title` is what the role actually means. A visitor has no way to know whether
 * "developer" outranks "moderator", and the badge is the only place to say.
 */
export const ROLE_META: Record<AnyRole, { label: string; tone: string; title: string }> = {
  owner: {
    label: 'Owner',
    tone: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
    title: 'Runs the All Levels List',
  },
  developer: {
    label: 'Developer',
    tone: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40',
    title: 'Builds and maintains the site',
  },
  admin: {
    // Violet, not the site accent: that was the same amber as `owner`, and it
    // would also follow a custom list's colour on the list's own pages.
    label: 'Admin',
    tone: 'bg-violet-500/15 text-violet-300 border border-violet-500/40',
    title: 'Places levels, edits the list and moderates the site',
  },
  moderator: {
    label: 'Moderator',
    tone: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    title: 'Reviews submissions, records and reports',
  },
  user: {
    label: 'User',
    tone: 'bg-zinc-900 text-zinc-500 border border-zinc-800',
    title: 'A member of the site',
  },
  'list-owner': {
    label: 'Owner',
    tone: 'bg-accent/10 text-accent border border-accent/40',
    title: 'Created this list and decides who edits it',
  },
  'list-editor': {
    label: 'Editor',
    tone: 'bg-zinc-900 text-zinc-400 border border-zinc-800',
    title: 'Can change this list and review what is submitted to it',
  },
}

export function roleMeta(role: string | null | undefined) {
  return ROLE_META[(role ?? 'user') as AnyRole] ?? ROLE_META.user
}

/**
 * Tailwind classes for a role badge.
 *
 * Kept because several places want only the colours — `RoleBadge` is the one
 * that draws the whole chip, and is what new call sites should use.
 */
export function roleBadgeClass(role: string | null | undefined): string {
  return roleMeta(role).tone
}
