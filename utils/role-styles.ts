export type Role = 'user' | 'moderator' | 'admin' | 'owner' | 'developer'

/**
 * Tailwind classes for role badges. Owner and developer share admin-level
 * permissions but render with their own colour so the label is recognisable
 * at a glance.
 */
export function roleBadgeClass(role: string | null | undefined): string {
  switch (role) {
    case 'owner':
      return 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
    case 'developer':
      return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
    case 'admin':
      return 'bg-accent/15 text-accent border border-accent/30'
    case 'moderator':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
    default:
      return 'bg-zinc-900 text-zinc-500 border border-zinc-800'
  }
}
