import { writeFile } from 'node:fs/promises'

export default async (db, out, check) => {
  await db.query('analyze users."user"')
  await db.query('analyze cms.document')
  const plans = []
  for (const sort of ['name', 'email', 'deactivated']) {
    for (const search of ['', 'Paging']) {
      const column = {
        name: 'lower(name)',
        email: 'email',
        deactivated: '(deactivated_at is not null)',
      }[sort]
      const order = `${column} asc, id asc`
      const where = search
        ? 'true and (strpos(lower(name), lower($1)) > 0 or strpos(lower(email), lower($1)) > 0)'
        : 'true'
      const sql = `with filtered as not materialized (
        select * from users."user" where ${where}
      ), paged as (
        select * from filtered order by ${order} limit 25 offset 25
      ) select (select count(*)::float8 from filtered) as total,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'email', email, 'locale', admin_locale,
          'deactivated', deactivated_at is not null,
          'roleIds', coalesce((select jsonb_agg(role_id order by role_id)
            from users.user_role where user_id = paged.id), '[]'::jsonb)
        ) order by ${order}) from paged), '[]'::jsonb) as users,
        coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)
          order by built_in desc, lower(name), id) from users.role), '[]'::jsonb) as roles`
      const params = search ? [search] : []
      const plan = (await db.query(`explain (analyze, buffers) ${sql}`, params)).rows
        .map((row) => row['QUERY PLAN'])
        .join('\n')
      plans.push({ endpoint: 'users', sort, search, sql, params, plan })
      if (search === '' && sort !== 'deactivated')
        check(
          plan.includes(`using user_list_${sort}`),
          `full users ${sort} statement naturally uses its ordering index`,
        )
    }
  }
  for (const sort of ['title', 'path', 'status', 'updatedAt']) {
    for (const search of ['', 'Paging']) {
      const column = {
        title: 'lower(title)',
        path: 'lower(path)',
        status: 'status',
        updatedAt: 'updated_at',
      }[sort]
      const order = `${column} desc, id desc`
      const title = `coalesce(nullif(case when jsonb_typeof(draft -> 'data' -> $1 -> $2) = 'string' then draft -> 'data' -> $1 -> $2 #>> '{}' end, ''),
        nullif(draft -> 'locales' -> $2 -> 'seo' ->> 'title', ''),
        nullif(draft -> 'locales' -> $2 ->> 'path', ''), 'Untitled')`
      const sql = `with summaries as not materialized (
        select id, key as collection, ${title} as title,
          coalesce(draft -> 'locales' -> $2 ->> 'path', '') as path,
          case when published is null then 'draft' when draft = published then 'published' else 'changed' end as status,
          updated_at, published_at
        from cms.document where kind = 'item' and key = $3
      ), filtered as not materialized (
        select * from summaries ${search ? 'where strpos(lower(title), lower($4)) > 0 or strpos(lower(path), lower($4)) > 0' : ''}
      ), paged as (
        select * from filtered order by ${order} limit 25 offset 25
      ) select (select count(*)::float8 from filtered) as total,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', id::text, 'collection', collection, 'title', title, 'path', path, 'status', status,
          'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'publishedAt', to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by ${order}) from paged), '[]'::jsonb) as rows`
      const params = ['title', 'en', 'posts', ...(search ? [search] : [])]
      const plan = (await db.query(`explain (analyze, buffers) ${sql}`, params)).rows
        .map((row) => row['QUERY PLAN'])
        .join('\n')
      plans.push({ endpoint: 'items', sort, search, sql, params, plan })
      if (search === '' && sort === 'updatedAt')
        check(
          plan.includes('using document_item_list'),
          'full items statement naturally uses the default ordering index',
        )
    }
  }
  await writeFile(`${out}/explain.json`, JSON.stringify(plans, null, 2))
  await writeFile(
    `${out}/explain.log`,
    plans
      .map(
        ({ endpoint, sort, search, sql, params, plan }) =>
          `${endpoint} sort=${sort} search=${JSON.stringify(search)}\n${sql}\nparams=${JSON.stringify(params)}\n${plan}`,
      )
      .join('\n\n'),
  )
  await writeFile(
    `${out}/explain-indexed.log`,
    plans
      .filter(
        (row) =>
          row.search === '' &&
          ((row.endpoint === 'users' && row.sort !== 'deactivated') ||
            (row.endpoint === 'items' && row.sort === 'updatedAt')),
      )
      .map(({ sql, params, plan }) => `${sql}\nparams=${JSON.stringify(params)}\n${plan}`)
      .join('\n\n'),
  )
}
