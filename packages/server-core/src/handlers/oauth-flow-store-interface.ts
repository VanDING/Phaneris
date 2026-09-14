/**
 * IOAuthFlowStore — abstract interface for the pending OAuth flow store.
 *
 * Handlers program against this; concrete implementations satisfy it.
 * See OAuthFlowStore in @phaneris/shared/auth for the canonical impl.
 */

import type { PendingOAuthFlow } from '@phaneris/shared/auth'

export interface IOAuthFlowStore {
  store(flow: PendingOAuthFlow): void
  getByState(state: string): PendingOAuthFlow | null
  remove(state: string): void
}
