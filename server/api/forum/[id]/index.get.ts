import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { getThread, listPosts } from '~/server/utils/forum'

/** One thread and every reply to it. Public, like the list it came from. */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad thread id.' })
  }

  const db = getDb()
  const me = getCurrentAccount(event)
  const thread = getThread(db, id, me?.id ?? null)
  if (!thread) throw createError({ statusCode: 404, statusMessage: 'No such thread.' })

  return {
    thread,
    posts: listPosts(db, id),
    viewer: {
      signedIn: !!me,
      username: me?.username ?? null,
      /**
       * Whether this viewer may pin, lock or delete. Decided here rather than
       * from the role in the client, so the buttons and the endpoints agree
       * about who is staff.
       */
      isStaff: !!me && me.role !== 'user',
      isAuthor: !!me && thread.author?.username === me.username,
    },
  }
})
