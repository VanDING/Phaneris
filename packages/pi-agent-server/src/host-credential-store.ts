import { InMemoryCredentialStore, type AuthOperationOptions, type Credential, type OAuthCredential } from '@earendil-works/pi-ai';

/** Rotation stays under the SDK provider lock until the host has persisted it. */
export class HostCredentialStore extends InMemoryCredentialStore {
  constructor(private readonly persist: (provider: string, credential: OAuthCredential) => Promise<void>) { super(); }

  /** Host-owned seeds/updates are already persisted and must not echo back. */
  inject(provider: string, credential: Credential): Promise<Credential | undefined> {
    return super.modify(provider, async () => credential);
  }

  override modify(provider: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return super.modify(provider, async current => {
      const next = await fn(current);
      if (next?.type === 'oauth' && current?.type === 'oauth'
        && (next.access !== current.access || next.refresh !== current.refresh || next.expires !== current.expires)) {
        // Cancellation can stop waiting for the lock, but cannot discard a rotation
        // already started. The host acknowledgement is deliberately not abortable.
        await this.persist(provider, next);
      }
      return next;
    }, options);
  }
}
