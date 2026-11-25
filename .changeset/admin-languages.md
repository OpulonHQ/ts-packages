---
'@opulonjs/admin': minor
'@opulonjs/ui': minor
'@opulonjs/users': minor
'@opulonjs/cms': minor
'@opulonjs/emails': minor
'@opulonjs/media': minor
---

A host chooses the admin languages: `createAdmin({ locales: ['en', 'it'], defaultLocale: 'it' })`. The language menu, the language picker on the account and user screens, Nuxt UI's own texts and the kit's texts follow that list; a user whose saved language is not offered gets the default. With one language offered the language menu is hidden. Without `locales` the admin offers English and Slovak as before.

The packages ship Italian catalogs next to English and Slovak for the shell, the kit and the users, cms, emails and media modules. `@opulonjs/ui` exports `nuxtUiIt`; `useAdmin().locales` holds the offered list.

An admin module needs only an English catalog: `defineAdminModule({ messages: { en } })`. Other languages are optional and may be partial, and a text a language lacks is shown in English. The type check that a second catalog labels every permission and audit action is gone; only the English catalog must label them.
