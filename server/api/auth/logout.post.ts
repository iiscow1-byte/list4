import { destroySession, clearSessionCookie, SESSION_COOKIE } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) destroySession(token)
  clearSessionCookie(event)
  return { ok: true }
})
