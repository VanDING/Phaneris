#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPhanerisReadOnlyBashPatterns } from './cli-domains.ts'
import { CLI_NAME } from '../identity.generated.ts'

/** Prefix identifying a bash allowlist entry for the product CLI. */
const CLI_BASH_PATTERN_PREFIX = `^${CLI_NAME}\\s`;

interface AllowedBashEntry {
  pattern: string
  comment?: string
}

interface PermissionsConfig {
  version?: string
  allowedBashPatterns?: AllowedBashEntry[]
  [key: string]: unknown
}

function isCraftAgentPattern(entry: AllowedBashEntry): boolean {
  return typeof entry.pattern === 'string' && entry.pattern.startsWith(CLI_BASH_PATTERN_PREFIX)
}

function syncCraftAgentPatterns(config: PermissionsConfig): PermissionsConfig {
  const patterns = config.allowedBashPatterns ?? []
  const firstCraftIndex = patterns.findIndex(isCraftAgentPattern)

  const withoutCraft = patterns.filter(entry => !isCraftAgentPattern(entry))
  const generated = getPhanerisReadOnlyBashPatterns()

  const insertAt = firstCraftIndex >= 0 ? firstCraftIndex : withoutCraft.length
  const nextAllowedBashPatterns = [
    ...withoutCraft.slice(0, insertAt),
    ...generated,
    ...withoutCraft.slice(insertAt),
  ]

  return {
    ...config,
    allowedBashPatterns: nextAllowedBashPatterns,
  }
}

function main() {
  const targetPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'apps/electron/resources/permissions/default.json')

  const config = JSON.parse(readFileSync(targetPath, 'utf-8')) as PermissionsConfig
  const nextConfig = syncCraftAgentPatterns(config)

  writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8')
  process.stdout.write(`Synced CLI bash patterns in ${targetPath}\n`)
}

if (import.meta.main) {
  main()
}
