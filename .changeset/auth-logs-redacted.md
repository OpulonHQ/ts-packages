---
'@opulonjs/core': patch
'@opulonjs/users': patch
---

Better Auth no longer prints its log messages or failing errors whole: an unexpected error fails the request and the Worker logs its names and codes (a Postgres error's SQLSTATE included), and Better Auth's other log lines reach the Effect log with their messages dropped. `describeError` (core) is the redaction both use.

Sign-in refuses a request whose `Origin` is another site (login CSRF), and a session revoked while Better Auth refreshes it answers as signed out instead of a 500.
