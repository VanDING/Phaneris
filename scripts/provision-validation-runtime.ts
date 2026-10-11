#!/usr/bin/env bun
/** Supply the same verified, pinned uv binary as packaging before clean-checkout validation. */
import { resolve, join } from 'node:path'
import { downloadUv, type Platform, type Arch } from './build/common'

const args = process.argv.slice(2)
if (args.some(arg => !arg.startsWith('--repository='))) throw new Error('Only --repository=<root> is supported')
const rootDir = resolve(args.find(arg => arg.startsWith('--repository='))?.slice(13) ?? resolve(import.meta.dir, '..'))
if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) {
  throw new Error(`Unsupported validation runtime: ${process.platform}-${process.arch}`)
}
await downloadUv({ rootDir, electronDir: join(rootDir, 'apps/electron'),
  platform: process.platform as Platform, arch: process.arch as Arch,
  upload: false, uploadLatest: false, uploadScript: false })
