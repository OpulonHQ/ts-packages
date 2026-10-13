/**
 * A failure's names and codes (`_tag` or `name`, then `code`, e.g. a SQLSTATE), nested causes
 * included. Never messages or stacks: they can carry user data (a Postgres error quotes the
 * value it rejected; a schema error's stack names the input path).
 */
export const describeError = (error: unknown, depth = 0): Record<string, unknown> => {
  if (typeof error !== 'object' || error === null) return { error: typeof error }
  const e = error as { _tag?: unknown; name?: unknown; code?: unknown; cause?: unknown }
  return {
    error: String(e._tag ?? e.name ?? 'unknown'),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(e.cause !== undefined && depth < 3 ? { cause: describeError(e.cause, depth + 1) } : {}),
  }
}
