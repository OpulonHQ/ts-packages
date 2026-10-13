import { Effect } from 'effect'
import { SqlClient } from 'effect/sql/SqlClient'

// A session is created only for an active user whose password is still the one sign-in verified
// (`password_stamp`: SHA-256 hex of that stored hash). The check runs in the insert itself and
// row-locks the user and the credential, so it serializes with deactivation (updates the user,
// then deletes sessions) and password reset (updates the credential, then deletes sessions):
// whichever commits first, the other sees its outcome. A refused insert is skipped (no row),
// which Better Auth answers as a failed sign-in.
export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`alter table users.session add column password_stamp text`
  yield* sql`create function users.guard_session_insert() returns trigger language plpgsql as $$
    begin
      perform from users."user" where id = new.user_id and deactivated_at is null for share;
      if not found then return null; end if;
      perform from users.account
        where user_id = new.user_id and provider_id = 'credential'
          and encode(sha256(convert_to(password, 'UTF8')), 'hex') = new.password_stamp
        for share;
      if not found then return null; end if;
      return new;
    end $$`
  yield* sql`create trigger guard_session_insert before insert on users.session
    for each row execute function users.guard_session_insert()`
})
