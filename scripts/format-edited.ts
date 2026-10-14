import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = dirname(import.meta.dirname)
const { cwd = root, tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'))
const patched = [
  ...String(input.command ?? '').matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm),
]
const files = [input.file_path, ...patched.map(([, file = '']) => file.trim())]
  .filter((file): file is string => typeof file === 'string' && file !== '')
  .map((file) => resolve(cwd, file))
  .filter((file) => !relative(root, file).startsWith('..') && existsSync(file))

if (files.length > 0)
  spawnSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--ignore-unknown', '--log-level', 'warn', ...files],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  )
