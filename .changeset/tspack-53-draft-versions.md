---
"@opulonjs/cms": minor
---

Two editors on the same page, item, site settings or menu no longer overwrite each other's draft. Every document now carries a `version` that every draft write (save, publish, revision restore) advances. Saving, publishing or restoring a revision names the version the editor loaded; when the draft changed meanwhile, the request answers 409 `CmsConflict` with reason `draft_changed` and changes nothing. The admin keeps the editor's unsaved input on screen, says the draft changed, and offers to reload it.

Breaking changes for API consumers:

- `PUT /cms/pages/{id}/draft`, `POST /cms/pages/{id}/publish`, `PUT /cms/items/{id}/draft`, `POST /cms/items/{id}/publish`, `PUT /cms/settings/draft`, `POST /cms/settings/publish`, `PUT /cms/menus/{key}/draft`, `POST /cms/menus/{key}/publish` and the four `POST .../revisions/{revisionId}/restore` endpoints (under the host's API prefix, `/api` by default) require a `version` query parameter: the `version` of the document as last read. Without it they answer 400. Read the document first, or use the document the previous save, publish or restore returned.
- `Page`, `PageSummary`, `Item`, `ItemSummary`, `SiteSettings`, `Menu` and `MenuSummary` have a new `version` field.
- The server services `Pages.saveDraft(id, version, draft)`, `Pages.publish(id, version)`, `Items.saveDraft(id, version, draft)`, `Items.publish(id, version)`, `Settings.saveDraft(version, draft)`, `Settings.publish(version)`, `Menus.saveDraft(key, version, draft)`, `Menus.publish(key, version)` and every `restoreRevision(..., revisionId, version)` (`@opulonjs/cms/server`) take the loaded version. `Settings` and `Menus` saves, publishes and restores can now fail with `CmsConflict`.
- Migration `0005_document_version` adds `cms.document.version`; run `opulon migrate` before deploying.
