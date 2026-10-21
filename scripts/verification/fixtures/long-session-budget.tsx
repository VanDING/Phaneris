/**
 * Long-session draw-cost fixture.
 *
 * Renders the real `SessionViewer` with a synthetic 200-turn transcript so the
 * workflow can measure what a long conversation actually costs: initial paint,
 * scripted scrolling, incremental appends (the streaming shape), and — because
 * `depth=glass` is the theme that adds `backdrop-filter` — the same page with a
 * glass panel overlaid on it.
 *
 * The messages are synthetic; every component, style and animation is the
 * shipped one.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { SessionViewer, TooltipProvider } from '@phaneris/ui'
import type { StoredSession } from '@phaneris/core'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('long-session fixture requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

const TURNS = 200

const PARAGRAPH = [
  'The runtime keeps a single JSONL-over-stdio channel to the agent subprocess, so every',
  'delta crosses a process boundary before the renderer sees it. That is why the transcript',
  'is memoised per turn and why an append cannot invalidate earlier rows.',
].join(' ')

const REPLY = [
  '## What changed',
  '',
  PARAGRAPH,
  '',
  '| Surface | Cost | Note |',
  '| --- | --- | --- |',
  '| Transcript row | memoised | append-only |',
  '| Composer | 1 animation | height only |',
  '',
  '```ts',
  'const rows = turns.map(turn => <TurnCard key={turn.id} turn={turn} />)',
  '```',
  '',
  'Closing note: the ordering above is what keeps a long session from repainting.',
].join('\n')

function makeMessages(count: number) {
  return Array.from({ length: count * 2 }, (_, index) => {
    const turn = Math.floor(index / 2)
    const isUser = index % 2 === 0
    return isUser
      ? { id: `u-${turn}`, type: 'user' as const, timestamp: index, content: `Turn ${turn + 1}: please review the ${turn % 7 === 0 ? 'database' : 'renderer'} changes.` }
      : { id: `a-${turn}`, type: 'assistant' as const, timestamp: index, isIntermediate: false, content: REPLY }
  })
}

const session: StoredSession = {
  id: 'perf',
  name: 'Long session budget',
  workspaceId: 'fixture',
  createdAt: 1,
  lastUsedAt: 1,
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  messages: makeMessages(TURNS),
} as StoredSession

function Harness() {
  const [messages, setMessages] = React.useState(session.messages)
  const [glass, setGlass] = React.useState(false)
  // The workflow drives both levers from the page: append a single turn (the
  // streaming shape) and toggle a glass panel over the transcript.
  React.useEffect(() => {
    window.longSession = {
      appendTurn: () => setMessages(current => [
        ...current,
        { id: `u-live-${current.length}`, type: 'user' as const, timestamp: current.length, content: 'Live turn appended while scrolled to the bottom.' },
        { id: `a-live-${current.length}`, type: 'assistant' as const, timestamp: current.length + 1, isIntermediate: false, content: REPLY },
      ]),
      setGlass,
      ready: true,
    }
  }, [])

  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <div data-perf-root className="h-screen bg-background text-foreground">
          <SessionViewer
            session={{ ...session, messages }}
            mode="readonly"
            defaultExpanded={false}
          />
          {glass && (
            <div
              data-glass-panel
              className="fixed right-6 top-6 h-64 w-80 rounded-shape-xl bg-background/60 shadow-strong backdrop-blur-xl"
            />
          )}
        </div>
      </TooltipProvider>
    </I18nextProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)

declare global {
  interface Window {
    longSession: { appendTurn: () => void; setGlass: (value: boolean) => void; ready: true }
  }
}
