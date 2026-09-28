import { expect, it } from 'bun:test'
import { generateCallbackPage } from '../callback-page'

// Failure cases: upstream title/logo survives; provider error text becomes markup;
// a quoted return URL escapes the inline script or link attribute.
it('brands success and failure pages as Phaneris and escapes provider text', () => {
  for (const isSuccess of [true, false]) {
    const html = generateCallbackPage({ title: '<test>', isSuccess, errorDetail: '<img src=x onerror=alert(1)>' })
    expect(html).toContain('<title>Phaneris - &lt;test&gt;</title>')
    expect(html).not.toContain('Craft')
    expect(html).not.toContain('████')
    expect(html).not.toContain('<img src=x')
  }
})
it('keeps callback URL data out of executable markup', () => {
  const html = generateCallbackPage({ title: 'Connected', isSuccess: true, deeplinkUrl: "phaneris://session/a'</script>" })
  expect(html.match(/<\/script>/g)).toHaveLength(1)
  expect(html).toContain('&#39;')
})
