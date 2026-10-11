/** Finite renderer ports. The legacy ElectronAPI is installed only after initialization. */
import type { ElectronAPI, TransportConnectionState } from '../../shared/types'

export type ClientCapability = 'native-file' | 'native-window' | 'clipboard' | 'notification'
export interface ClientPlatform {
  readonly kind: 'electron' | 'web'
  readonly sessions: Pick<ElectronAPI, 'getSessions' | 'getSessionMessages' | 'sendMessage' | 'cancelProcessing' | 'onSessionEvent'>
  readonly connection: Pick<ElectronAPI, 'getTransportConnectionState' | 'onTransportConnectionStateChanged' | 'reconnectTransport'>
  readonly files: Pick<ElectronAPI, 'readFile' | 'readFileBinary' | 'readFilePreviewDataUrl' | 'openFile' | 'showInFolder'>
  readonly navigation: Pick<ElectronAPI, 'openUrl' | 'switchWorkspace' | 'getWindowWorkspace'>
  readonly preferences: Pick<ElectronAPI, 'readPreferences' | 'writePreferences' | 'getThemePreferences' | 'setThemePreferences' | 'changeLanguage'>
  readonly drafts: Pick<ElectronAPI, 'getAllDrafts' | 'getDraft' | 'setDraft'>
  readonly notification: Pick<ElectronAPI, 'showNotification'>
  readonly clipboard: { writeText(text: string): Promise<void> }
  hasCapability(capability: ClientCapability): boolean
}

export class ClientCapabilityError extends Error {
  readonly code = 'CAPABILITY_UNAVAILABLE'
  constructor(capability: string) { super(`Client capability unavailable: ${capability}`); this.name = 'ClientCapabilityError' }
}
export function unavailableClientCapability(capability: string): Promise<never> {
  return Promise.reject(new ClientCapabilityError(capability))
}
function bindPorts<Keys extends keyof ElectronAPI>(api: ElectronAPI, keys: readonly Keys[]): Pick<ElectronAPI, Keys> {
  return Object.freeze(Object.fromEntries(keys.map(key => [key, typeof api[key] === 'function' ? api[key].bind(api) : api[key]]))) as Pick<ElectronAPI, Keys>
}
export function createClientPlatform(kind: ClientPlatform['kind'], api: ElectronAPI): ClientPlatform {
  return Object.freeze({ kind,
    sessions: bindPorts(api, ['getSessions', 'getSessionMessages', 'sendMessage', 'cancelProcessing', 'onSessionEvent']),
    connection: bindPorts(api, ['getTransportConnectionState', 'onTransportConnectionStateChanged', 'reconnectTransport']),
    files: bindPorts(api, ['readFile', 'readFileBinary', 'readFilePreviewDataUrl', 'openFile', 'showInFolder']),
    navigation: bindPorts(api, ['openUrl', 'switchWorkspace', 'getWindowWorkspace']),
    preferences: bindPorts(api, ['readPreferences', 'writePreferences', 'getThemePreferences', 'setThemePreferences', 'changeLanguage']),
    drafts: bindPorts(api, ['getAllDrafts', 'getDraft', 'setDraft']),
    notification: bindPorts(api, ['showNotification']),
    clipboard: { writeText: (text: string) => navigator.clipboard?.writeText(text) ?? unavailableClientCapability('clipboard') },
    hasCapability: (capability: ClientCapability) => capability === 'clipboard' ? !!navigator.clipboard
      : capability === 'notification' ? kind === 'electron' || 'Notification' in window && Notification.permission === 'granted'
      : kind === 'electron',
  })
}

let initialized: ClientPlatform | undefined
export function getClientPlatform(): ClientPlatform {
  if (!initialized) throw new Error('initializeClient(platform) must finish before rendering business components')
  return initialized
}

/** Await the real transport, with bounded subscription and abort ownership. */
export async function initializeClient(platform: ClientPlatform, legacy: ElectronAPI, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Client initialization aborted', 'AbortError')
  const state = await platform.connection.getTransportConnectionState()
  if (state.status !== 'connected') await new Promise<void>((resolve, reject) => {
    let settled = false, off: () => void = () => {}
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); off(); signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    const abort = () => finish(new DOMException('Client initialization aborted', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('Client transport initialization timed out')), 30_000)
    signal?.addEventListener('abort', abort, { once: true })
    off = platform.connection.onTransportConnectionStateChanged((next: TransportConnectionState) => {
      if (next.status === 'connected') finish()
      else if (next.status === 'failed') finish(new Error(next.lastError?.message ?? 'Client transport initialization failed'))
    })
    if (settled) off()
    if (signal?.aborted) abort()
  })
  if (signal?.aborted) throw new DOMException('Client initialization aborted', 'AbortError')
  initialized = platform
  // Electron's context bridge exposes a read-only property. Web owns installation.
  if (window.electronAPI !== legacy) window.electronAPI = legacy
  document.documentElement.dataset.clientPlatform = platform.kind
}
