import { requireAdmin } from '~/server/utils/auth'
import { setSignupsEnabled, signupsEnabled, setAdminOnly, adminOnly } from '~/server/utils/site-access'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Open or close registration, without a redeploy.
 *
 * Admin only, and logged: whether anyone can join is one of the few settings
 * that changes who the site is for, so the log should say who changed it and
 * when. `ALLOW_SIGNUPS` in the environment still decides the value on a fresh
 * database; from the first time this is used, the stored value wins.
 */
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const body = await readBody<{ setting?: string; enabled?: boolean }>(event)
  const enabled = !!body?.enabled
  // Defaults to the registration switch so the original one-purpose callers
  // keep working unchanged.
  const setting = body?.setting === 'admin_only' ? 'admin_only' : 'signups'

  if (setting === 'admin_only') {
    setAdminOnly(enabled)
    logActivity({
      kind: 'site.access',
      area: 'accounts',
      severity: 'warn',
      actor: { id: admin.id, username: admin.username, role: admin.role },
      summary: enabled ? 'Closed the site to staff only' : 'Opened the site to everyone',
    })
  } else {
    setSignupsEnabled(enabled)
    logActivity({
      kind: 'site.signups',
      area: 'accounts',
      severity: 'warn',
      actor: { id: admin.id, username: admin.username, role: admin.role },
      summary: enabled ? 'Opened account registration' : 'Closed account registration',
    })
  }

  return { ok: true, signupsEnabled: signupsEnabled(), adminOnly: adminOnly() }
})
