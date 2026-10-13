import type en from './en.ts'

export default {
  nav: { library: 'Médiá' },
  library: {
    title: 'Médiá',
    description: 'Obrázky a PDF pre web. Archivované položky naďalej fungujú tam, kde sú použité.',
    upload: 'Nahrať',
    empty: 'Zatiaľ žiadne médiá.',
    caption: 'Knižnica médií',
  },
  columns: {
    preview: 'Náhľad',
    filename: 'Súbor',
    type: 'Typ',
    size: 'Veľkosť',
    updatedAt: 'Upravené',
  },
  filters: {
    type: 'Typ',
    image: 'Obrázky',
    pdf: 'PDF',
    status: 'Stav',
    active: 'Aktívne',
    archived: 'Archivované',
  },
  details: {
    title: 'Detail média',
    alt: 'Alternatívny text',
    altHelp: 'Opisuje obrázok pre čítačky obrazovky a vyhľadávače.',
    caption: 'Popis',
    save: 'Uložiť',
    saved: 'Uložené.',
    replace: 'Nahradiť súbor',
    replaced: 'Súbor bol nahradený. Stránky, ktoré položku používajú, teraz zobrazujú novú verziu.',
    archive: 'Archivovať',
    archiveTitle: 'Archivovať túto položku?',
    archiveWarning:
      'Zmizne z knižnice a z výberu, ale stránky, ktoré ju už používajú, ju budú naďalej zobrazovať.',
    archived: 'Archivované.',
    restore: 'Obnoviť',
    restored: 'Obnovené.',
    open: 'Otvoriť originál',
    archivedBadge: 'Archivované',
  },
  picker: {
    choose: 'Vybrať médium',
    change: 'Zmeniť',
    clear: 'Odstrániť',
    none: 'Nie je vybrané žiadne médium.',
    title: 'Vybrať médium',
  },
  errors: {
    failed: 'Akcia zlyhala. Skúste to znova.',
  },
  permissions: {
    'media.view': 'Zobraziť médiá',
    'media.upload': 'Nahrávať a upravovať médiá',
    'media.archive': 'Archivovať médiá',
  },
  audit: {
    'media.item.uploaded': 'Médium nahrané',
    'media.item.replaced': 'Súbor média nahradený',
    'media.item.updated': 'Detail média upravený',
    'media.item.archived': 'Médium archivované',
    'media.item.restored': 'Médium obnovené',
  },
} satisfies typeof en
