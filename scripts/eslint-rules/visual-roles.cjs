/** Literal checks stay separate from component geometry and authored content. */
module.exports = {
  meta: { type: 'suggestion', schema: [], messages: {
    literal: 'Use an existing visual role for UI color, text size or shape; register an owned primitive when a literal is required.',
    control: 'Native interactive controls need a craft control/field/row role for focus, scale and touch behavior.',
    reveal: 'Hover actions need focus and coarse-pointer reveal; use craft-row-actions or an explicit equivalent.',
  } },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode()
    const role = /craft-(?:control|icon-button|field|menu-item|settings-row|row-focus|row-actions|nav-item|segment)/
    function hasRole(node, seen = new Set()) {
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (node.type === 'Literal') return typeof node.value === 'string' && role.test(node.value)
      if (node.type === 'JSXExpressionContainer') return hasRole(node.expression, seen)
      if (node.type === 'CallExpression') return node.arguments.some(value => hasRole(value, seen)) || hasRole(node.callee, seen)
      if (node.type === 'Identifier') {
        for (let scope = source.getScope(node); scope; scope = scope.upper) {
          const variable = scope.set.get(node.name)
          if (variable) return variable.defs.some(value => hasRole(value.node.init, seen))
        }
      }
      if (node.type === 'ConditionalExpression') return hasRole(node.consequent, seen) && hasRole(node.alternate, seen)
      if (node.type === 'TemplateLiteral') return node.quasis.some(value => role.test(value.value.cooked ?? ''))
      return false
    }
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return
        if (/(?:^|[\s:])(?:bg|text|border|ring|fill|stroke)-\[(?:#[\da-f]|(?:rgb|hsl|oklch)\()|(?:^|[\s:])(?:text|rounded)-\[\d+(?:\.\d+)?px\]/i.test(node.value)) context.report({ node, messageId: 'literal' })
      },
      Property(node) {
        const key = node.key.name ?? node.key.value
        if (/^(color|backgroundColor|borderColor|outlineColor|fill|stroke)$/.test(key) && node.value.type === 'Literal'
          && typeof node.value.value === 'string' && /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch)\()/i.test(node.value.value)) context.report({ node: node.value, messageId: 'literal' })
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !['button', 'input', 'select', 'textarea'].includes(node.name.name)) return
        const text = source.getText(node)
        const className = node.attributes.find(value => value.type === 'JSXAttribute' && value.name.name === 'className')
        if (!role.test(text) && !hasRole(className?.value)) context.report({ node, messageId: 'control' })
        if (/opacity-0/.test(text) && /(?:group-)?hover:opacity-100/.test(text)
          && !/craft-row-actions/.test(text) && !(/focus(?:-visible|-within)?:opacity-100/.test(text) && /pointer-coarse:opacity-100/.test(text))) context.report({ node, messageId: 'reveal' })
      },
    }
  },
}
