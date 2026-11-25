import { expect, test } from 'vitest'
import { useTestDatabase } from '../../../test/postgres/index.ts'
import { makeHost, seedUser } from './support/users.ts'

const db = useTestDatabase()
const host = makeHost(() => db.url)

test('the demo notes search answers the notes containing the term, any case', async () => {
  const user = await seedUser(db.url, { permissions: ['demo.notes.view'] })
  const cookie = await host.signIn(user.email, user.password)
  const search = async (q: string) =>
    (await host.request('GET', `/demo/notes/search?q=${encodeURIComponent(q)}`, { cookie })).body
  expect(await search('HELLO')).toEqual([{ id: 1, body: 'hello from demo' }])
  expect(await search('%')).toEqual([])
  expect(await search('')).toEqual([{ id: 1, body: 'hello from demo' }])
})
