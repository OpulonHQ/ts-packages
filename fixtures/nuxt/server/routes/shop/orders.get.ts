import { staff } from '../../../../host/server/staff.ts'

export default defineEventHandler(async (event) => {
  const check = await staff.require(
    toWebRequest(event),
    event.context.cloudflare.env,
    'shop.orders.view',
  )
  if (!check.ok) return check.response
  for (const cookie of check.setCookies) appendResponseHeader(event, 'set-cookie', cookie)
  return { viewer: check.user.id, orders: [] }
})
