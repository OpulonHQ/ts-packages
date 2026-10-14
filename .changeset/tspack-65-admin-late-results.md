---
"@opulonjs/admin": patch
---

An unmounted admin no longer changes the page around it. A language save that fails after the admin unmounted shows no error toast in the admin mounted after it, and a sign-in or any other push or replace navigation that finishes after the unmount leaves the browser URL where the host moved it. Language saves from one admin now run one at a time, each after the previous one answered, so the language picked last is the one the server keeps. If a save from an admin that already unmounted lands after a newer pick, the newer pick is saved again. An admin mounted while such a save is on its way shows the language it saved once it answers. A second pick waits for the first save's answer before it is sent, and a pick still waiting when the admin unmounts is not sent. While a pick waits, the shell keeps the language it shows and still applies everything else the server answers, such as a sign-out or a new deploy.
