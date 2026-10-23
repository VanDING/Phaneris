import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { DocumentFormattedMarkdownOverlay, TooltipProvider } from '@phaneris/ui'
import { TurnCard, type ActivityItem } from '../../../packages/ui/src/components/chat/TurnCard'
import { groupMessagesByTurn, formatActivityAsMarkdown } from '../../../packages/ui/src/components/chat/turn-utils'
import { processEvent } from '../../../apps/electron/src/renderer/event-processor/processor'

await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URLSearchParams(location.search).get('css')!; document.head.append(style)
document.body.className = 'bg-background text-foreground'
const initial: any = { session: { id: 'fixture', workspaceId: 'fixture', messages: [{ id: 'user', role: 'user', content: 'Inspect the fixture', timestamp: 1 }], isProcessing: true }, streaming: null }
function Harness() {
  const [state, setState] = React.useState(initial), [detail, setDetail] = React.useState<ActivityItem | null>(null)
  const [buffer, setBuffer] = React.useState<number | null>(null)
  React.useEffect(() => {
    ;(window as any).thinkingFixture = { emit: (event: any) => setState((s: any) => processEvent(s, { sessionId: 'fixture', ...event }).state),
      snapshot: () => state, restore: (value: any) => setState(value), buffer: () => setBuffer(Date.now()), ready: true }
  }, [state])
  const turn = groupMessagesByTurn(state.session.messages, { isSessionProcessing: state.session.isProcessing }).findLast(t => t.type === 'assistant')
  return <I18nextProvider i18n={i18n}><TooltipProvider><main className="mx-auto max-w-3xl p-6" data-thinking-fixture>
    {buffer ? <TurnCard turnId="buffer" activities={[]} isStreaming isComplete={false} response={{ text: '中文短回复无需空格也能及时显示。', isStreaming: true, streamStartTime: buffer }} /> : turn?.type === 'assistant' && <TurnCard turnId={turn.turnId} activities={turn.activities} response={turn.response}
      isStreaming={turn.isStreaming} isComplete={turn.isComplete} defaultExpanded onOpenActivityDetails={setDetail} />}
    <DocumentFormattedMarkdownOverlay isOpen={!!detail} onClose={() => setDetail(null)} content={detail ? formatActivityAsMarkdown(detail) : ''} />
  </main></TooltipProvider></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
