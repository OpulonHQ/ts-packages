---
'@opulonjs/admin': patch
---

`opulonAdmin()` finds the admin screens of every installed `@opulonjs/*` package (an `./admin` export in the host's package.json dependencies) and scans them for icons and Tailwind classes. A host no longer lists package directories in `sources`; before, a package left out (or every package, when installed from npm) rendered its buttons and nav items without icons.
