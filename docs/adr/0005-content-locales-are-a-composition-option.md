# Content locales are set once, at composition

The host app declares its content locales once, in `composeServer({ contentLocales: ['en', 'it'] })`; the first is the default. Core validates them at startup, provides them to every module through the `ContentLocales` reference, and returns them to the admin in `/me`. Media keeps alt text and captions per content locale against this list, and cms localized fields and per-locale paths use the same list, so the two can never disagree, and the admin build needs no copy of it.

We rejected a per-module option (`media({ locales })`, `cms({ locales })`), which hosts would have to keep in sync, and a `createAdmin` option, which would put a server fact into the browser build and drift from the server after a deploy. Admin locales are a separate concept (per user, en and sk) and stay in the admin. Decided in TSPACK-31.
