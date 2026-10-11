/** Owns only SDK session construction/disposal. Execution and durable authority remain in the host. */
export class SessionLifecycle<Session extends { dispose(): void }> {
  private session: Session | null = null
  private creating: Promise<Session> | null = null
  private resetting: Promise<void> | null = null
  private generation = 0

  get current(): Session | null { return this.session }

  getOrCreate(build: () => Promise<Session>, onCreated: (session: Session) => void): Promise<Session> {
    if (this.resetting) return Promise.reject(new Error('SDK session is being reinitialized'))
    if (this.session) return Promise.resolve(this.session)
    if (this.creating) return this.creating
    const generation = this.generation
    const creating = Promise.resolve().then(build).then(session => {
      if (generation !== this.generation) { session.dispose(); throw new Error('SDK session creation was invalidated') }
      this.session = session
      onCreated(session)
      return session
    }).finally(() => { if (this.creating === creating) this.creating = null })
    this.creating = creating
    return creating
  }

  reset(): Promise<void> {
    if (this.resetting) return this.resetting
    this.generation++
    const current = this.session
    this.session = null
    current?.dispose()
    const creating = this.creating
    const resetting = (async () => { if (creating) await creating.catch(() => undefined) })()
      .finally(() => { if (this.resetting === resetting) this.resetting = null })
    this.resetting = resetting
    return resetting
  }
}
