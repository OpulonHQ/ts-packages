---
'@opulonjs/emails': minor
'@opulonjs/admin': minor
'@opulonjs/ui': minor
---

Email template overrides: `emailsAdmin()` adds an email templates screen (permission `emails.templates.manage`) listing every contributed template with its audience, placeholders and per-locale override state, and an editor to override subject and body per locale, insert placeholders and email components, preview with sample values, send a test to yourself through the outbox, reset to the default and turn a template off (its sends are logged as `skipped`). Overrides are sanitized to the restricted rich text format on save and at render; edits and test sends are audited (`emails.template.*`). Email components are written as `[[name prop="value"]]` in bodies (code defaults included) and rendered at send time: the package ships `button`, `callout`, `divider` and `table`, and hosts add their own with `emails({ components: [emailComponent({ name, props, render })] })`. `@opulonjs/admin` re-exports `useRoute` and `RouterLink` for module screens; `RichTextControl` exposes `insert(content)`.
