import { expect, test } from 'vitest'
import * as admin from '@opulonjs/admin'
import * as cms from '@opulonjs/cms'
import * as core from '@opulonjs/core'
import * as emails from '@opulonjs/emails'
import * as media from '@opulonjs/media'
import * as ui from '@opulonjs/ui'
import * as users from '@opulonjs/users'

// Runs before any build: passes only when packages resolve to src through @opulonjs/source.
test('the host resolves every package from source', () => {
  expect([core, ui, admin, users, emails, media, cms].map((p) => p.packageName)).toEqual([
    '@opulonjs/core',
    '@opulonjs/ui',
    '@opulonjs/admin',
    '@opulonjs/users',
    '@opulonjs/emails',
    '@opulonjs/media',
    '@opulonjs/cms',
  ])
})
