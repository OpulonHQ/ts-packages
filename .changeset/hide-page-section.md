---
'@opulonjs/cms': minor
---

An editor can hide a page section from the public site without deleting it. Every section in the page editor has a "Hide on the site" switch, and the outline marks a hidden section. `Section` gains an optional `hidden` key, stored only when true, so existing sections stay visible and a section shown again leaves the page in sync with its published version. The Read API's `resolve()` leaves hidden sections out. The page preview keeps them with `hidden: true`, and `CmsSections` renders their root with `data-cms-hidden` and one `<style>` that marks them as hidden. Hiding is a draft change: it reaches the site on publish and discarding the draft undoes it.
