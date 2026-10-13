---
'@opulonjs/admin': patch
'@opulonjs/users': patch
'@opulonjs/ui': patch
---

The sidebar's user block opens a user menu: the user's name and email, account settings, a language submenu and sign-out. The auth provider supplies the account route (`accountRoute`) and saves the language (`setLocale`); the users module no longer lists My account in the nav. Everything clickable shows the pointer cursor, table rows with a row action included.
Language names start with a capital (`Slovenčina`, `Angličtina`) in the user menu, the account language picker and `LocaleTabs`, through the new `languageName` helper.
