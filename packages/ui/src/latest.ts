/**
 * A request ticket for one caller: `const mine = next()` before each request; apply the answer
 * only while `mine()` is true, so an answer a newer request superseded is dropped.
 */
export const latestOnly = () => {
  let latest = 0
  return () => {
    const mine = ++latest
    return () => mine === latest
  }
}
