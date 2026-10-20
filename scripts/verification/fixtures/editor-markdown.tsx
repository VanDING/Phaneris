/**
 * Real markdown editor surfaces for the editor acceptance workflow.
 *
 * Two production mounts sit side by side, both from the real renderer bundle:
 * - `#artifact-pane` renders the app's `MarkdownArtifactEditor` — the editor the
 *   artifact workbench shows — which lazy-loads the official Tiptap engine and
 *   owns the lossless round-trip gate that decides between visual and source mode.
 * - `#visual-pane` renders the same production `TiptapMarkdownEditor` directly
 *   with `markdownEngine="official"`, for documents the artifact gate routes to
 *   source mode (the acceptance corpus contains a raw HTML comment).
 *
 * The document corpus is not hard-coded here: the workflow sets it through
 * `window.editorFixture`. The host (`window.electronAPI`) is a stub; the theme
 * provider, the i18n instance and both editors are the production ones.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
// Direct module paths, not the `@phaneris/ui` barrel: the package is excluded from
// dependency optimization, so a barrel import makes the dev server transform the
// whole UI library before the editor can mount. Same components either way.
import { ShikiThemeProvider } from '../../../packages/ui/src/context/ShikiThemeContext'
import { DEFAULT_THEME_FILE } from '../../../packages/shared/src/config/theme'
import { ThemeProvider, useTheme } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { MarkdownArtifactEditor } from '../../../apps/electron/src/renderer/components/content-panels/MarkdownArtifactEditor'
import { TiptapMarkdownEditor } from '../../../packages/ui/src/components/markdown/TiptapMarkdownEditor'
import '../../../apps/electron/src/renderer/index.css'

export type Pane = 'artifact' | 'visual'

export interface EditorEvent {
  type: string
  pane: Pane
  /** `CompositionEvent.data`: the IME candidate text the browser reported. */
  data: string | null
  inputType: string | null
  isComposing: boolean | null
  /** Editor text at the instant the event fired — proves the composing text was visible. */
  text: string
  at: number
}

export interface PaneState {
  pane: Pane
  mounted: boolean
  editor: boolean
  editable: string | null
  focused: boolean
  text: string
  html: string
  blocks: { tag: string; type: string | null; text: string }[]
  buttons: { text: string; pressed: string | null; disabled: boolean }[]
  status: string[]
  textarea: string | null
  language: string | null
  selection: string | null
  bubble: (string | null)[]
}

export interface EditorFixtureApi {
  readonly ready: boolean
  renders: () => number
  /** Replace a pane's document. The editor is re-created, so the markdown engine runs from scratch. */
  setMarkdown: (text: string, pane?: Pane) => Promise<void>
  /** Current markdown as the editor itself serialized it. */
  getMarkdown: (pane?: Pane) => string
  /** Paste real `text/html` through a real ClipboardEvent into the visual editor. */
  insertHtml: (html: string) => Promise<{ cancelled: boolean; text: string }>
  language: (code: string) => Promise<void>
  setUiLanguage: (code: string) => Promise<void>
  setMode: (mode: 'light' | 'dark') => void
  pane: (pane: Pane) => PaneState
  panes: () => Record<Pane, PaneState>
  events: () => EditorEvent[]
  resetEvents: () => void
  trace: () => { at: number; editable: string | null; source: boolean; status: string[]; buttons: string[] }[]
  focus: (pane: Pane, where?: 'start' | 'end') => void
  /** Caret position inside a pane, as the text that precedes it. */
  caret: (pane?: Pane) => { before: string; collapsed: boolean } | null
  i18n: () => { language: string; resolved: string }
  bodyText: () => string
  unknownApi: () => string[]
  artifact: () => { markdown: string; value: string }
}

declare global {
  interface Window {
    editorFixture: EditorFixtureApi
  }
}

const ARTIFACT_DOC = '# 产物验收\n\n正文段落。\n'
const VISUAL_DOC = '# 可视化验收\n\n段落 **加粗**。\n'

const unknownApi = new Set<string>()
const events: EditorEvent[] = []
/** Settling samples taken while a pane is re-created; evidence when a gate never settles. */
const trace: { at: number; editable: string | null; source: boolean; status: string[]; buttons: string[] }[] = []
let renders = 0

function paneOf(target: EventTarget | null): Pane | null {
  const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!node) return null
  if (node.closest('#artifact-pane')) return 'artifact'
  if (node.closest('#visual-pane')) return 'visual'
  return null
}
function paneRoot(pane: Pane) {
  return document.querySelector<HTMLElement>(`#${pane}-pane`)
}
function paneEditor(pane: Pane) {
  return paneRoot(pane)?.querySelector<HTMLElement>('.tiptap') ?? null
}
function editorText(pane: Pane) {
  return paneEditor(pane)?.innerText ?? ''
}

// Composition evidence is collected at the document level in the capture phase:
// the editor DOM is re-created by `setMarkdown`, and every IME event bubbles.
for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'] as const) {
  document.addEventListener(type, event => {
    const pane = paneOf(event.target)
    if (!pane || events.length >= 500) return
    const composition = event as CompositionEvent
    const input = event as InputEvent
    events.push({
      type, pane,
      data: typeof composition.data === 'string' ? composition.data : null,
      inputType: typeof input.inputType === 'string' ? input.inputType : null,
      isComposing: typeof input.isComposing === 'boolean' ? input.isComposing : null,
      text: editorText(pane),
      at: Math.round(performance.now() * 100) / 100,
    })
  }, true)
}

function readPane(pane: Pane): PaneState {
  const root = paneRoot(pane)
  const editor = paneEditor(pane)
  const selection = window.getSelection()
  return {
    pane,
    mounted: Boolean(root),
    editor: Boolean(editor),
    editable: editor?.getAttribute('contenteditable') ?? null,
    focused: Boolean(editor) && document.activeElement === editor,
    text: editor?.innerText ?? '',
    html: editor?.innerHTML ?? '',
    blocks: editor ? [...editor.children].map(child => ({
      tag: child.tagName.toLowerCase(),
      type: child.getAttribute('data-type'),
      text: (child as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    })) : [],
    buttons: [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map(button => ({
      text: (button.textContent ?? '').trim(),
      pressed: button.getAttribute('aria-pressed'),
      disabled: button.disabled,
    })),
    status: [...(root?.querySelectorAll<HTMLElement>('[role="status"]') ?? [])].map(node => (node.textContent ?? '').trim()),
    textarea: root?.querySelector<HTMLTextAreaElement>('[data-testid="artifact-source-editor"]')?.value ?? null,
    language: document.documentElement.getAttribute('lang'),
    selection: selection && selection.rangeCount > 0 && editor?.contains(selection.anchorNode) ? String(selection) : null,
    bubble: [...document.querySelectorAll<HTMLElement>('.tiptap-bubble-btn')].map(node => node.getAttribute('title')),
  }
}

async function until(predicate: () => boolean, timeout: number, message: string) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }
}

const explicit: Record<string, unknown> = {
  // Theme preferences: the renderer host answers these before the theme provider
  // mounts, so the fixture answers them the same way.
  getThemePreferences: async () => ({ mode: 'light', colorTheme: 'default', font: 'theme' }),
  setThemePreferences: async (preferences: unknown) => preferences,
  loadPresetTheme: async () => ({ id: 'default', path: 'builtin:default', theme: DEFAULT_THEME_FILE }),
  getSystemTheme: async () => false,
}
const electronApi = new Proxy(explicit, {
  get(target, key) {
    if (typeof key !== 'string' || key === 'then') return undefined
    if (key in target) return target[key]
    if (key.startsWith('on')) return () => () => {}
    unknownApi.add(key)
    return async () => null
  },
})
Object.assign(window, { electronAPI: electronApi })

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en', keySeparator: false,
  resources: { en: { translation: en }, 'zh-Hans': { translation: zh } },
})

const shell = {
  workspaces: [{ id: 'ws-fixture', name: 'Fixture', rootPath: '/fixture', slug: 'fixture' }],
  activeWorkspaceId: 'ws-fixture',
  activeWorkspaceSlug: 'fixture',
  llmConnections: [],
  sessionOptions: new Map(),
  pendingPermissions: new Map(),
  pendingCredentials: new Map(),
  pendingQuestions: new Map(),
  refreshLlmConnections: async () => {},
  onOpenFile: () => {},
  onOpenUrl: () => {},
  getDraft: () => '',
  onCreateSession: async () => { throw new Error('createSession is not part of this fixture') },
} as unknown as AppShellContextType

function Fixture() {
  const theme = useTheme()
  renders += 1
  const [artifact, setArtifact] = React.useState({ text: ARTIFACT_DOC, generation: 0 })
  const [visual, setVisual] = React.useState({ text: VISUAL_DOC, generation: 0 })
  const [ready, setReady] = React.useState(false)
  const visualMarkdown = React.useRef(VISUAL_DOC)
  const visualReady = React.useRef(0)
  const artifactMarkdown = React.useRef(ARTIFACT_DOC)
  const readyRef = React.useRef(false)
  const themeReadyRef = React.useRef(false)
  readyRef.current = ready
  themeReadyRef.current = theme.themeLoadStatus === 'ready'

  // Readiness is the renderer's own signal: both editors are mounted and the
  // theme has settled. Never `networkidle` — the dev server keeps channels open.
  React.useEffect(() => {
    let cancelled = false
    const poll = () => {
      if (cancelled) return
      if (themeReadyRef.current && paneEditor('artifact') && paneEditor('visual')) { setReady(true); return }
      setTimeout(poll, 50)
    }
    poll()
    return () => { cancelled = true }
  }, [])

  const api = React.useMemo<EditorFixtureApi>(() => {
    // A keyed remount is only observable after React commits: until then the previous
    // editor is still in the DOM and answers every "settled" question with its own
    // state. Both waits therefore require a NEW element before they accept a state.
    const setMarkdown = async (text: string, pane: Pane = 'visual') => {
      if (pane === 'visual') {
        const before = visualReady.current
        const previous = paneEditor('visual')
        setVisual(state => ({ text, generation: state.generation + 1 }))
        await until(() => paneEditor('visual') !== previous && visualReady.current > before, 30_000, 'visual editor did not re-initialize')
        return
      }
      const previousEditor = paneEditor('artifact')
      const previousSource = paneRoot('artifact')?.querySelector('[data-testid="artifact-source-editor"]') ?? null
      artifactMarkdown.current = text
      setArtifact(state => ({ text, generation: state.generation + 1 }))
      await until(() => {
        const root = paneRoot('artifact')
        if (!root) return false
        const status = [...root.querySelectorAll<HTMLElement>('[role="status"]')].map(node => (node.textContent ?? '').trim())
        const editor = root.querySelector<HTMLElement>('.tiptap')
        // The artifact editor's own source textarea — not the bubble menu's inline-math
        // textarea, which is present whenever the visual editor is editable.
        const source = root.querySelector('[data-testid="artifact-source-editor"]')
        const buttons = [...root.querySelectorAll('button')].slice(0, 2).map(button => `${(button.textContent ?? '').trim()}:${button.disabled ? 'disabled' : 'enabled'}`)
        trace.push({ at: Math.round(performance.now()), editable: editor?.getAttribute('contenteditable') ?? null, source: Boolean(source), status, buttons })
        if (trace.length > 80) trace.shift()
        if (editor === previousEditor && source === previousSource) return false
        if (status.some(text => /Loading|加载中/.test(text))) return false
        // The gate rejects -> the editor settles in source mode.
        if (source) return true
        // The gate accepts -> editing is only enabled after its round-trip check.
        return editor?.getAttribute('contenteditable') === 'true'
      }, 30_000, 'artifact editor did not re-initialize')
    }
    return {
      get ready() { return readyRef.current },
      renders: () => renders,
      setMarkdown,
      getMarkdown: (pane: Pane = 'visual') => (pane === 'visual' ? visualMarkdown.current : artifactMarkdown.current),
      insertHtml: async (html: string) => {
        const editor = paneEditor('visual')
        if (!editor) throw new Error('visual editor is not mounted')
        editor.focus()
        const data = new DataTransfer()
        data.setData('text/html', html)
        data.setData('text/plain', html.replace(/<[^>]+>/g, ''))
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        const cancelled = !editor.dispatchEvent(event)
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        return { cancelled, text: editor.innerText }
      },
      language: async (code: string) => { await i18n.changeLanguage(code) },
      setUiLanguage: async (code: string) => { await i18n.changeLanguage(code) },
      setMode: (mode: 'light' | 'dark') => theme.setMode(mode),
      pane: (pane: Pane) => readPane(pane),
      panes: () => ({ artifact: readPane('artifact'), visual: readPane('visual') }),
      events: () => events.map(event => ({ ...event })),
      resetEvents: () => { events.length = 0 },
      trace: () => trace.map(sample => ({ ...sample })),
      focus: (pane: Pane, where: 'start' | 'end' = 'end') => {
        const editor = paneEditor(pane)
        if (!editor) throw new Error(`${pane} editor is not mounted`)
        editor.focus()
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(where === 'start')
        selection?.removeAllRanges()
        selection?.addRange(range)
      },
      caret: (pane: Pane = 'visual') => {
        const editor = paneEditor(pane)
        const selection = window.getSelection()
        if (!editor || !selection || selection.rangeCount === 0) return null
        const range = selection.getRangeAt(0)
        if (!editor.contains(range.startContainer)) return null
        const before = range.cloneRange()
        before.selectNodeContents(editor)
        before.setEnd(range.startContainer, range.startOffset)
        return { before: before.toString(), collapsed: range.collapsed }
      },
      i18n: () => ({ language: i18n.language, resolved: i18n.resolvedLanguage ?? i18n.language }),
      bodyText: () => document.body.innerText,
      unknownApi: () => [...unknownApi],
      artifact: () => ({ markdown: artifactMarkdown.current, value: artifact.text }),
    }
  }, [theme, artifact.text])

  React.useEffect(() => { window.editorFixture = api }, [api])

  return <ShikiThemeProvider shikiTheme={theme.shikiTheme}>
    <main className="flex min-h-screen flex-col gap-3 bg-background p-3 text-foreground">
      <section id="artifact-pane" data-pane="artifact" className="h-[380px] overflow-hidden rounded border border-border">
        <MarkdownArtifactEditor
          key={`artifact-${artifact.generation}`}
          value={artifact.text}
          onChange={text => {
            artifactMarkdown.current = text
            setArtifact(state => ({ ...state, text }))
          }}
        />
      </section>
      <section id="visual-pane" data-pane="visual" className="h-[380px] overflow-auto rounded border border-border p-3">
        <TiptapMarkdownEditor
          key={`visual-${visual.generation}`}
          content={visual.text}
          markdownEngine="official"
          onReady={markdown => { visualMarkdown.current = markdown; visualReady.current += 1 }}
          onUpdate={markdown => { visualMarkdown.current = markdown }}
        />
      </section>
    </main>
  </ShikiThemeProvider>
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider defaultMode="light">
        <AppShellProvider value={shell}>
          <Fixture />
        </AppShellProvider>
      </ThemeProvider>
    </I18nextProvider>
  </Provider>,
)
