import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { UserMessageBubble } from '../../../packages/ui/src/components/chat/UserMessageBubble'
import { handleUserMessage } from '../../../apps/electron/src/renderer/event-processor/handlers/session'
import type { SessionState, UserMessageEvent } from '../../../apps/electron/src/renderer/event-processor/types'
import '../../../apps/electron/src/renderer/index.css'
await i18next.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
const initial = { session: { id: 'receipt', messages: [], isProcessing: false, lastMessageAt: 0 }, streaming: null } as unknown as SessionState
function Fixture() {
  const [state, setState] = React.useState(initial)
  Object.assign(window, {
    receiptEvent: (event: UserMessageEvent) => setState(previous => handleUserMessage(previous, event).state),
    receiptSeed: (next: SessionState) => setState(next), receiptState: () => state,
  })
  return <I18nextProvider i18n={i18next}><main style={{ padding: 24 }}>{state.session.messages.map(message =>
    <div key={message.id} data-message-id={message.id}><UserMessageBubble content={message.content} isQueued={message.isQueued}
      inputReception={message.inputReception} /></div>)}</main></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
