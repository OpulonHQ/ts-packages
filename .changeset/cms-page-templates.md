---
'@opulonjs/cms': minor
---

Add page templates. `defineCms` takes `templates` by key: a `label`, an optional `description` and the `sections` a new page starts with, in order, each with its section `type` and optional `data` in the stored shape (localized fields hold `{ [locale]: value }`). `defineCms` throws when a template names an unknown section type or its data does not decode against that type's fields, unknown fields included; TypeScript also rejects an unknown section type. When the host defines templates, Content > Pages "New page" opens a picker with "Blank page" and every template, and the new page starts with the chosen template's sections. Without templates, "New page" creates a blank page in one click as before. Media ids are per database, so a template can only prefill an image whose id the host seeds.
