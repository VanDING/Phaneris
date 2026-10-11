/** Explicit production bootstrap: bundled SDK lazy modules and the durable default stream. */
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy'
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { setDefaultStreamFn, type StreamFn } from '@earendil-works/pi-agent-core'

export function registerPiSdkRuntime(stream: StreamFn): void {
  // Lazy relative modules do not exist after Bun collapses the SDK into one bundle.
  setBedrockProviderModule(bedrockProviderModule)
  registerBunOAuthFlows()
  setDefaultStreamFn(stream)
}
