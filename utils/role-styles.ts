import { BADGE_TONE, type BadgeTone } from '~/utils/badge-styles'

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
 * `tone` names a colour from the site's badge vocabulary rather than spelling
 * out classes, so a role can't quietly invent a shade nothing else uses — see
 * `utils/badge-styles.ts`.
 *
 * `title` is what the role actually means. A visitor has no way to know whether
 * "developer" outranks "moderator", and the badge is the only place to say.
 */
export const ROLE_META: Record<AnyRole, { label: string; tone: BadgeTone; title: string }> = {
  owner: {
    label: 'Owner',
    tone: 'amber',
    title: 'Runs the All Levels List',
  },
  developer: {
    label: 'Developer',
    tone: 'cyan',
    title: 'Builds and maintains the site',
  },
  admin: {
    // Violet, not the site accent: that was the same amber as `owner`, and it
    // would also follow a custom list's colour on the list's own pages.
    label: 'Admin',
    tone: 'violet',
    title: 'Places levels, edits the list and moderates the site',
  },
  moderator: {
    label: 'Moderator',
    tone: 'emerald',
    title: 'Reviews submissions, records and reports',
  },
  user: {
    label: 'User',
    tone: 'quiet',
    title: 'A member of the site',
  },
  'list-owner': {
    label: 'Owner',
    tone: 'accent',
    title: 'Created this list and decides who edits it',
  },
  'list-editor': {
    label: 'Editor',
    tone: 'quiet',
    title: 'Can change this list and review what is submitted to it',
  },
}

export function roleMeta(role: string | null | undefined) {
  return ROLE_META[(role ?? 'user') as AnyRole] ?? ROLE_META.user
}

/**
 * Tailwind colour classes for a role badge, without the geometry.
 *
 * Nothing paints its own role chip any more — the admin user table was the last
 * one, and it now uses `<RoleBadge always>`. Kept because a colour without a
 * chip is a reasonable thing to want (a border on a row, say) and because
 * deriving it by hand from `ROLE_META` is exactly how the copies started.
 */
export function roleBadgeClass(role: string | null | undefined): string {
  return BADGE_TONE[roleMeta(role).tone]
}
