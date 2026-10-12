export default {
  nav: { log: 'Záznam e-mailov' },
  log: {
    title: 'Záznam e-mailov',
    description: 'Všetky e-maily, ktoré systém za posledných 90 dní odoslal, aj s výsledkom.',
    empty: 'Zatiaľ žiadne e-maily.',
    failed: 'Záznam e-mailov sa nepodarilo načítať.',
    columns: {
      createdAt: 'Zaradený',
      templateKey: 'Šablóna',
      recipients: 'Príjemcovia',
      subject: 'Predmet',
      status: 'Stav',
      attempts: 'Pokusy',
    },
    status: { queued: 'Vo fronte', sent: 'Odoslaný', failed: 'Zlyhal', skipped: 'Vynechaný' },
  },
  permissions: { 'emails.log.view': 'Zobraziť záznam e-mailov' },
}
