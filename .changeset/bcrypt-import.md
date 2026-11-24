---
'@opulonjs/users': minor
---

Sign-in verifies imported bcrypt password hashes (`$2a$`, `$2b$`, `$2y$`) and replaces one with the current `pbkdf2v1:` format on the first successful sign-in. `importUsers` from `@opulonjs/users/server` creates users with their old hash and roles; see the package README. Adds the `bcryptjs` dependency and the `users.imported` audit action.
