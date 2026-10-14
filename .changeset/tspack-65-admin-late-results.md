---
"@opulonjs/admin": patch
---

An unmounted admin no longer changes the page around it. A language save that fails after the admin unmounted shows no error toast in the admin mounted after it, and a sign-in or any other navigation that finishes after the unmount leaves the browser URL where the host moved it. Language saves now run one at a time, each after the previous one answered, so the language picked last is the one the server keeps. A second pick waits for the first save's answer before it is sent, and a pick still waiting when the admin unmounts is not sent. While a pick waits, the shell keeps the language it shows and still applies everything else the server answers, such as a sign-out or a new deploy.
