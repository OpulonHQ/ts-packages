import signIn from './sign-in.mjs'

/** Reuses the saved session when it is still valid; signs in through the UI otherwise. */
export default async (ctx) => {
  const me = await ctx.page.request.get(`${ctx.base}/api/me`)
  if (me.ok()) return ctx.check(true, `session reused for ${(await me.json()).user.email}`)
  await signIn(ctx)
}
