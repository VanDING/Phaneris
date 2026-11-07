import assert from 'node:assert/strict'
import sharp from 'sharp'
import { generateImageWithOpenAI, ImageGenerationError } from '../../packages/server-core/src/services/image-generation'
import { verificationWorkflow } from './verification-artifacts'

await verificationWorkflow('dependency-upgrade-20261107-images', async run => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#446688' } }).png().toBuffer()
  let responseFormat: string | undefined = 'png'
  const requests: unknown[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.json())
    return Response.json({ created: 1, output_format: responseFormat, data: [{ b64_json: bytes.toString('base64') }],
      usage: { input_tokens: 11, output_tokens: 17, total_tokens: 28 } })
  } })
  const results: Array<{ scene: string; format?: string; message?: string }> = []
  const config = { apiKey: 'synthetic-local-key', baseUrl: server.url.href, maxRetries: 0, timeoutMs: 10_000 }
  try {
    for (const format of ['png', undefined]) {
      responseFormat = format
      const image = await generateImageWithOpenAI(config, { prompt: 'local format acceptance' })
      assert.equal(image.format, 'png')
      assert(image.bytes.equals(bytes))
      results.push({ scene: format ? 'supported-png' : 'missing-format-falls-back-to-request', format: image.format })
    }
    for (const format of ['gif', 'svg', 'jpeg']) {
      responseFormat = format
      await assert.rejects(generateImageWithOpenAI(config, { prompt: 'local format rejection' }), error => {
        assert(error instanceof ImageGenerationError)
        assert.deepEqual(error.usage, { inputTokens: 11, outputTokens: 17 })
        assert.match(error.message, format === 'jpeg' ? /does not match the declared JPEG/ : /unsupported image format/i)
        results.push({ scene: format === 'jpeg' ? 'payload-signature-mismatch' : `unsupported-${format}`, message: error.message })
        return true
      })
    }
    run.json('images.json', { results, requests, paidApis: false, sharp: sharp.versions })
    run.complete(results.map(result => result.scene), ['Live provider accounts', 'New GIF/SVG generation capability is outside this migration'])
  } finally { server.stop(true) }
})
