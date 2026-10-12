import type en from './en.ts'

export default {
  fields: {
    email: 'E-mail',
    password: 'Heslo',
    newPassword: 'Nové heslo',
    confirmPassword: 'Zopakujte heslo',
    name: 'Vaše meno',
  },
  signIn: {
    title: 'Prihlásenie',
    submit: 'Prihlásiť sa',
    invalid: 'E-mail alebo heslo je nesprávne.',
    forgot: 'Zabudli ste heslo?',
  },
  forgot: {
    title: 'Obnovenie hesla',
    description: 'Zadajte e-mail a pošleme vám odkaz na nastavenie nového hesla.',
    submit: 'Poslať odkaz',
    sent: 'Ak adresa patrí používateľovi, e-mail s odkazom je na ceste.',
    back: 'Späť na prihlásenie',
  },
  reset: {
    title: 'Nastavenie nového hesla',
    submit: 'Nastaviť heslo',
    done: 'Heslo je nastavené. Prihláste sa ním.',
    invalid: 'Odkaz je neplatný alebo vypršal. Požiadajte o nový.',
  },
  invitation: {
    title: 'Prijatie pozvánky',
    description: 'Ste pozvaní ako {email}. Zvoľte si meno a heslo.',
    submit: 'Prijať a prihlásiť sa',
    invalid: 'Pozvánka je neplatná, použitá alebo vypršala. Požiadajte o novú.',
    taken: 'Používateľ s týmto e-mailom už existuje. Prihláste sa.',
  },
  errors: {
    mismatch: 'Heslá sa nezhodujú.',
    short: 'Použite aspoň 8 znakov.',
    tooMany: 'Príliš veľa pokusov. Počkajte minútu a skúste to znova.',
    failed: 'Niečo sa pokazilo. Skúste to znova.',
  },
  permissions: { 'users.manage': 'Pozývať a spravovať používateľov' },
  audit: {
    'users.signed_in': 'Prihlásenie',
    'users.sign_in_failed': 'Neúspešné prihlásenie',
    'users.signed_out': 'Odhlásenie',
    'users.invited': 'Pozvanie používateľa',
    'users.invitation_accepted': 'Prijatie pozvánky',
    'users.password_reset_requested': 'Žiadosť o obnovenie hesla',
    'users.password_reset': 'Obnovenie hesla',
  },
} satisfies typeof en
