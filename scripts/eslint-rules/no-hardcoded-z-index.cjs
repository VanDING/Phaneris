/** Shared AST rule: CSS stacking literals also hide in cn/cva and templates. */
module.exports = {
  meta: { type: 'suggestion', schema: [], messages: {
    noHardcodedZIndex: 'Avoid hardcoded zIndex values. Use a named global portal or local component token.',
  } },
  create(context) {
    const name = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : null
    const allowed = value => /var\(--z-/.test(value) || /^(auto|inherit|initial|unset|revert|revert-layer)$/.test(value.trim())
    const hardcoded = node => node?.type === 'Literal' ? typeof node.value === 'number' || typeof node.value === 'string' && !allowed(node.value)
      : node?.type === 'UnaryExpression' ? hardcoded(node.argument)
      : node?.type === 'ConditionalExpression' ? hardcoded(node.consequent) || hardcoded(node.alternate)
      : node?.type === 'TemplateLiteral' && !node.expressions.length ? !allowed(node.quasis.map(part => part.value.cooked ?? '').join('')) : false
    const report = node => context.report({ node, messageId: 'noHardcodedZIndex' })
    const classes = (node, value) => { if (/(?:^|[\s:])(?:-?z-\d+|-?z-\[-?\d+(?:\.\d+)?\])(?=$|\s)/.test(value)) report(node) }
    return {
      Literal(node) { if (typeof node.value === 'string') classes(node, node.value) },
      TemplateLiteral(node) {
        const text = node.quasis.map(part => part.value.cooked ?? '').join(' ')
        classes(node, text)
        if (node.expressions.length && node.quasis.some(part => /(?:^|[\s:])-?z-$/.test(part.value.cooked ?? ''))) report(node)
      },
      Property(node) { if (name(node.key) === 'zIndex' && hardcoded(node.value)) report(node.value) },
      AssignmentPattern(node) { if (name(node.left) === 'zIndex' && hardcoded(node.right)) report(node.right) },
      VariableDeclarator(node) { if (name(node.id) === 'zIndex' && hardcoded(node.init)) report(node.init) },
      AssignmentExpression(node) {
        if (node.left.type === 'MemberExpression' && name(node.left.property) === 'zIndex'
          && node.left.object.type === 'MemberExpression' && name(node.left.object.property) === 'style' && hardcoded(node.right)) report(node.right)
      },
    }
  },
}
