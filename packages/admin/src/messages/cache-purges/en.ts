export default {
  admin: {
    cachePurges: {
      stale: 'Live site may show the previous version until {time}.',
      queued: 'Cache purge is queued for retry.',
      failed: 'Cache purge failed after three attempts. Cached answers will expire automatically.',
      unavailable: 'Cache purge status is unavailable. Try again shortly.',
    },
  },
}
