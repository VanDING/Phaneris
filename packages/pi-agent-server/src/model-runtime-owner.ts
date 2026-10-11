/** One credential seed owner; only the primary session publishes its active model registry. */
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import { HostCredentialStore } from './host-credential-store'
import type { InitMessage } from './messages'

export class PiModelRuntimeOwner {
  private credentials: Promise<HostCredentialStore> | undefined
  private store: HostCredentialStore | null = null
  private registry: ModelRegistry | null = null
  private runtime: ModelRuntime | null = null
  get credentialStore(): HostCredentialStore | null { return this.store }
  get activeRegistry(): ModelRegistry | null { return this.registry }

  credentialStoreFor(config: Pick<InitMessage, 'apiKey' | 'piAuth'> | null,
    persist: (provider: string, credential: OAuthCredential) => Promise<void>,
    debug: (message: string) => void): Promise<HostCredentialStore> {
    return this.credentials ??= (async () => {
      const store = new HostCredentialStore(persist)
      if (config?.piAuth) {
        await store.inject(config.piAuth.provider, config.piAuth.credential as unknown as Credential)
        debug(`Injected ${config.piAuth.credential.type} credential for provider: ${config.piAuth.provider}`)
      } else if (config?.apiKey) {
        await store.modify('anthropic', async () => ({ type: 'api_key', key: config.apiKey } as Credential))
        debug('Injected API key into credential store (legacy fallback)')
      }
      this.store = store
      return store
    })()
  }
  publish(runtime: ModelRuntime, registry: ModelRegistry): void { this.runtime = runtime; this.registry = registry }
  reset(): void { this.credentials = undefined; this.store = null; this.registry = null; this.runtime = null }
}
