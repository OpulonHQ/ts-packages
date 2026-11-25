import type en from './en.ts'

export default {
  admin: {
    cachePurges: {
      stale: 'Il sito pubblico può mostrare la versione precedente fino alle {time}.',
      queued: 'Lo svuotamento della cache è in coda per un nuovo tentativo.',
      failed:
        'Lo svuotamento della cache non è riuscito dopo tre tentativi. Le risposte in cache scadranno automaticamente.',
      unavailable: 'Lo stato dello svuotamento della cache non è disponibile. Riprova tra poco.',
    },
  },
} satisfies typeof en
