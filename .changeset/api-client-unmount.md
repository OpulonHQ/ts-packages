---
'@opulonjs/admin': patch
'@opulonjs/users': patch
'@opulonjs/cms': patch
---

`useApiClient` called in a component's `setup` drops answers that arrive after that component unmounted: the returned promise never settles, so code after the `await` cannot change a screen, toast or route that moved on. The request itself still completes. Pass `useApiClient(group, { detached: true })` for a call handed to an owner that outlives the component, such as the `save` given to `useAdmin().saveLocale`; the users Account and User screens do.
