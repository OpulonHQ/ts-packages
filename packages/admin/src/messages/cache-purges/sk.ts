import type en from './en.ts'

export default {
  admin: {
    cachePurges: {
      stale: 'Živý web môže zobrazovať predchádzajúcu verziu do {time}.',
      queued: 'Čaká sa na opätovné vymazanie vyrovnávacej pamäte.',
      failed:
        'Vymazanie vyrovnávacej pamäte zlyhalo po troch pokusoch. Uložené odpovede automaticky vypršia.',
      unavailable: 'Stav vymazania vyrovnávacej pamäte nie je dostupný. Skúste to znova o chvíľu.',
    },
  },
} satisfies typeof en
