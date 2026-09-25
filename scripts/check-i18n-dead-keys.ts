#!/usr/bin/env bun
/**
 * check-i18n-dead-keys.ts — Report keys in en.json that nothing references.
 *
 * `check-i18n-coverage.ts` answers "does every reference resolve?"; this answers the
 * opposite question, which nothing checked before: "does every key still have a
 * reference?". A deleted page leaves its keys behind, and because parity and
 * coverage both stay green, they accumulate silently — seven translations of a
 * string no user can ever reach, and a locale file that no longer describes the UI.
 *
 * A key counts as referenced when:
 *   - a literal `t('key')` / `i18n.t('key')` / `<Trans i18nKey="key">` exists, or
 *   - the key appears as a bare string literal anywhere in source (this codebase
 *     stores `labelKey: 'apiSetup.credentials.environment'` and resolves it later,
 *     so a `t()`-only scan reports live keys as dead), or
 *   - its plural base is referenced (`foo.bar` satisfies `foo.bar_one`/`_other`), or
 *   - it matches a **dynamic prefix** taken from a template literal at a callsite
 *     (`t(\`status.${id}\`)` protects every `status.*` key), or
 *   - it is listed in `scripts/i18n-dead-key-allowlist.json`, for the handful of
 *     families resolved from data rather than from source text.
 *
 * The dynamic-prefix rule is deliberately coarse: it can hide a genuinely dead key
 * under a live prefix, and that is the right trade — a false "alive" costs nothing,
 * a false "dead" deletes a string the UI needs.
 *
 * Exit 0 when nothing is dead; 1 with the list otherwise. Pass --all to print every
 * key (default truncates to 40).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_PATH = join(ROOT, 'packages/shared/src/i18n/locales/en.json')
const ALLOWLIST_PATH = join(ROOT, 'scripts/i18n-dead-key-allowlist.json')

const SCAN_DIRS = [
  'apps/electron/src',
  'apps/viewer/src',
  'apps/webui/src',
  'packages/shared/src',
  'packages/ui/src',
]

const EXCLUDE_DIR_NAMES = new Set(['node_modules', 'dist', 'build'])
const EXCLUDE_FILE_PATTERNS = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /\.d\.ts$/]
const SOURCE_EXT = /\.(?:ts|tsx)$/
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/

const KEY_PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9_$.])t\(\s*(['"])([^'"`\\\n]+)\1/g,
  /\bi18n(?:ext)?\.t\(\s*(['"])([^'"`\\\n]+)\1/g,
  /\bi18nKey\s*=\s*(['"])([^'"`\\\n]+)\1/g,
]

/**
 * A dotted key prefix built by interpolation, anywhere in source.
 *
 * Not limited to `t(\`…\`)`: this repo also builds the key in a helper and returns
 * it (`return \`contentPanel.button.${kind}\`` in surface-launchers.ts), so anchoring
 * on the `t(` call reported every launcher key as dead.
 */
const TEMPLATE_PREFIX = /`([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*\.)\$\{/g

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (EXCLUDE_DIR_NAMES.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out)
      continue
    }
    if (!SOURCE_EXT.test(name)) continue
    if (EXCLUDE_FILE_PATTERNS.some((p) => p.test(name))) continue
    out.push(full)
  }
  return out
}

/** Any quoted or plain template string. */
const STRING_LITERAL = /(['"`])([^'"`\n]{2,120})\1/g

function main(): void {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Record<string, string>
  const enKeys = Object.keys(en)

  let allowlist: string[] = []
  try {
    allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8')) as string[]
  } catch {
    // No allowlist file is a valid state: everything must be referenced.
  }

  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files)

  const enKeySet = new Set(enKeys)
  const referenced = new Set<string>()
  const prefixes = new Set<string>(allowlist)

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const pattern of KEY_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        const key = match[2]
        if (!key) continue
        referenced.add(key)
        // A reference to the base key covers its plural forms and vice versa.
        referenced.add(key.replace(PLURAL_SUFFIX, ''))
      }
    }
    /*
     * Bare string literals that exactly equal a key. The repo resolves many strings
     * indirectly (a config carries `labelKey`, a table carries `statusKey`), so a
     * scan that only follows `t()` would flag live keys and the check would be
     * ignored. Exact equality against en.json keeps this precise.
     */
    STRING_LITERAL.lastIndex = 0
    let literal: RegExpExecArray | null
    while ((literal = STRING_LITERAL.exec(content)) !== null) {
      const value = literal[2]
      if (value && enKeySet.has(value)) referenced.add(value)
    }
    TEMPLATE_PREFIX.lastIndex = 0
    let template: RegExpExecArray | null
    while ((template = TEMPLATE_PREFIX.exec(content)) !== null) {
      const prefix = template[1]
      if (prefix) prefixes.add(prefix)
    }
  }

  const dead = enKeys.filter((key) => {
    if (referenced.has(key)) return false
    if (referenced.has(key.replace(PLURAL_SUFFIX, ''))) return false
    for (const prefix of prefixes) {
      if (prefix && key.startsWith(prefix)) return false
    }
    return true
  })

  if (dead.length === 0) {
    console.log(`i18n dead keys OK (${enKeys.length} en keys, all referenced)`)
    return
  }

  const shown = process.argv.includes('--all') ? dead : dead.slice(0, 40)
  console.error(`i18n dead-key check failed: ${dead.length} key(s) referenced nowhere`)
  for (const key of shown) console.error(`  ${key}`)
  if (shown.length < dead.length) console.error(`  … and ${dead.length - shown.length} more (--all)`)
  console.error(
    '\nRemove them from every locale, or — when a key is resolved from data rather\n' +
      'than from source text — add its prefix to scripts/i18n-dead-key-allowlist.json.',
  )
  process.exit(1)
}

main()
