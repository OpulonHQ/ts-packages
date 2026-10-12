# The email log is the outbox

Sending an email writes an email log row in the caller's transaction with status `queued`. After commit, the row is delivered through `waitUntil`, and a cron sweep retries rows left `queued` with bounded attempts. The row id doubles as the provider's idempotency key. A rolled-back transaction therefore never emails, a committed one always gets a delivery attempt, and the admin log shows exactly what the outbox holds.

We rejected sending inline in the request, which emails on rollback and fails the request when the provider is down. We also rejected Cloudflare Queues for v1: every host would need another binding, and providers other than Workers would need another path. Queues can replace the `waitUntil` + cron delivery later without changing the send API. Decided in TSPACK-12.
