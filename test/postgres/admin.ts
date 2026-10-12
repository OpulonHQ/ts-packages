import pg from 'pg'

export async function adminQuery<R extends pg.QueryResultRow>(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return (await client.query<R>(sql)).rows
  } finally {
    await client.end()
  }
}

export function databaseUrl(serverUrl: string, database: string) {
  const url = new URL(serverUrl)
  url.pathname = `/${database}`
  return url.toString()
}
