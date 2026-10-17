/**
 * ESLint Rule: no-arbitrary-scale
 *
 * Rejects new arbitrary font-size, radius and control-height literals.
 * Allowed values come from `scripts/scale-allowlist.snapshot.json`:
 *   contract tiers ∪ frozen legacy values.
 * Existing legacy values stay silent so migration happens through the ledger,
 * not through suppress comments. Regenerate the snapshot with
 * `bun run scale:generate` after a migration batch.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const allowlist = JSON.parse(readFileSync(join(__dirname, '../../../scripts/scale-allowlist.snapshot.json'), 'utf8'))

const FAMILIES = [
  {
    key: 'fontSize',
    label: 'font size',
    pattern: /text-\[(\d+(?:\.\d+)?)px\]/g,
    anchor: 'DESIGN.md#typography',
    genericHint: 'use a type tier',
  },
  {
    key: 'radius',
    label: 'radius',
    pattern: /rounded(?:-[trblse]{1,2})?-\[(\d+(?:\.\d+)?)px\]/g,
    anchor: 'DESIGN.md#shapes',
    genericHint: 'use a radius tier or a role shape',
  },
  {
    key: 'controlHeight',
    label: 'control height',
    pattern: /(?<![\w-])(?:h|min-h|max-h|size)-\[(\d+(?:\.\d+)?)px\]/g,
    anchor: 'DESIGN.md#layout',
    genericHint: 'use a control height tier, a spacing step, or a role token',
  },
]

const allowed = Object.fromEntries(FAMILIES.map(family => [
  family.key,
  new Set([...allowlist.contract[family.key], ...allowlist.legacy[family.key]]),
]))

function nearest(family, value) {
  const tiers = Object.entries(allowlist.tiers[family])
  let best = tiers[0]
  for (const entry of tiers) {
    if (Math.abs(parseFloat(entry[1].value) - value) < Math.abs(parseFloat(best[1].value) - value)) best = entry
  }
  return best[1]
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Reject arbitrary scale literals that are not part of the design contract.',
    },
    schema: [],
    messages: {
      scale: 'Arbitrary {{family}} {{value}} is outside the scale contract. Use {{hint}} (nearest: {{tier}}). See {{anchor}}.',
    },
  },
  create(context) {
    function check(node, text) {
      for (const family of FAMILIES) {
        for (const match of text.matchAll(family.pattern)) {
          const value = `${match[1]}px`
          if (allowed[family.key].has(value)) continue
          const tier = nearest(family.key, parseFloat(match[1]))
          context.report({
            node,
            messageId: 'scale',
            data: {
              family: family.label,
              value,
              hint: family.genericHint,
              tier: `${tier.className} (${tier.value})`,
              anchor: family.anchor,
            },
          })
        }
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) check(quasi, quasi.value.cooked ?? quasi.value.raw)
      },
    }
  },
}
