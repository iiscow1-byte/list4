import { getCurrentAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  return { account: getCurrentAccount(event) }
})
