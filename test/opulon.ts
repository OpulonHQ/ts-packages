import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('../packages/core/src/cli.ts', import.meta.url))

/** Runs the `opulon` CLI from source (cwd = repo root). Rejects with stdout/stderr on a non-zero exit. */
export async function runOpulon(args: ReadonlyArray<string>, env: Record<string, string>) {
  return promisify(execFile)(
    process.execPath,
    ['--conditions=@opulonjs/source', '--no-warnings', cli, ...args],
    { cwd: root, env: { ...process.env, ...env } },
  )
}
