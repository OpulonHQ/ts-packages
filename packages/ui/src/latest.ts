export const requestTickets = () => {
  let latest = 0
  return {
    next: () => {
      const mine = ++latest
      return { isLatest: () => mine === latest }
    },
  }
}
