import type en from './en.ts'

export default {
  nav: { library: 'Media' },
  library: {
    title: 'Media',
    description:
      'Immagini e PDF per il sito. Gli elementi archiviati continuano a funzionare dove sono usati.',
    upload: 'Carica',
    empty: 'Ancora nessun file multimediale.',
    caption: 'Libreria multimediale',
  },
  columns: {
    preview: 'Anteprima',
    filename: 'File',
    type: 'Tipo',
    size: 'Dimensione',
    updatedAt: 'Aggiornato',
  },
  filters: {
    type: 'Tipo',
    image: 'Immagini',
    pdf: 'PDF',
    status: 'Stato',
    active: 'Attivi',
    archived: 'Archiviati',
  },
  details: {
    title: 'Dettagli del file',
    alt: 'Testo alternativo',
    altHelp: 'Descrive l’immagine per gli screen reader e i motori di ricerca.',
    caption: 'Didascalia',
    save: 'Salva',
    saved: 'Salvato.',
    replace: 'Sostituisci il file',
    replaced:
      'File sostituito. Le pagine che usano questo elemento mostrano ora la nuova versione.',
    archive: 'Archivia',
    archiveTitle: 'Archiviare questo elemento?',
    archiveWarning:
      'Scompare dalla libreria e dal selettore, ma le pagine che già lo usano continuano a mostrarlo.',
    archived: 'Archiviato.',
    restore: 'Ripristina',
    restored: 'Ripristinato.',
    open: 'Apri l’originale',
    archivedBadge: 'Archiviato',
  },
  picker: {
    choose: 'Scegli un file multimediale',
    change: 'Cambia',
    clear: 'Rimuovi',
    none: 'Nessun file multimediale selezionato.',
    title: 'Scegli un file multimediale',
  },
  errors: {
    failed: 'L’azione non è riuscita. Riprova.',
  },
  permissions: {
    'media.view': 'Visualizzare i media',
    'media.upload': 'Caricare e modificare i media',
    'media.archive': 'Archiviare i media',
  },
  audit: {
    'media.item.uploaded': 'File multimediale caricato',
    'media.item.replaced': 'File multimediale sostituito',
    'media.item.updated': 'Dettagli del file multimediale modificati',
    'media.item.archived': 'File multimediale archiviato',
    'media.item.restored': 'File multimediale ripristinato',
  },
} satisfies typeof en
