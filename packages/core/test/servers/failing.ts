import { composeServer } from '../../src/index.ts'
import { media, migrationsOnly, run } from './modules.ts'

const broken = migrationsOnly(
  'broken',
  {
    '1_ok': run('create table broken.ok (id integer)'),
    '2_fails': run('select * from no_such_table'),
  },
  ['media'],
)
const downstream = migrationsOnly(
  'downstream',
  { '1_create': run('create table downstream.t (id integer)') },
  ['broken'],
)

export default composeServer({ modules: [media, broken, downstream] })
