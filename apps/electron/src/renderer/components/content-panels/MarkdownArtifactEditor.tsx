import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const RichEditor = React.lazy(() => import('@phaneris/ui/markdown/editor').then(module => ({ default: module.TiptapMarkdownEditor })))
const normalize = (text: string) => text.replace(/\r\n/g, '\n').trimEnd()

class EditorBoundary extends React.Component<{ children: React.ReactNode; fallback: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.fallback() }
  render() { return this.state.failed ? null : this.props.children }
}

/** Source stays authoritative until the parser demonstrates a lossless round-trip. */
export function MarkdownArtifactEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<'visual' | 'source'>('visual')
  const [lossless, setLossless] = React.useState(false)
  const [sourceRequired, setSourceRequired] = React.useState(false)
  const canWrite = React.useRef(false)
  const fail = React.useCallback(() => { canWrite.current = false; setSourceRequired(true); setLossless(false); setMode('source') }, [])
  const ready = React.useCallback((serialized: string) => {
    if (normalize(serialized) !== normalize(value)) fail()
    else { canWrite.current = true; setLossless(true) }
  }, [value, fail])
  return <div className="flex h-full min-h-0 flex-col" data-testid="artifact-markdown-editor">
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Button size="sm" variant={mode === 'visual' ? 'secondary' : 'ghost'} aria-pressed={mode === 'visual'} disabled={sourceRequired}
        onClick={() => { canWrite.current = false; setLossless(false); setMode('visual') }}>{t('artifact.visualEditor')}</Button>
      <Button size="sm" variant={mode === 'source' ? 'secondary' : 'ghost'} aria-pressed={mode === 'source'} onClick={() => { canWrite.current = false; setMode('source') }}>{t('artifact.sourceEditor')}</Button>
      {sourceRequired && <span role="status" className="text-sm text-foreground/80">{t('artifact.sourceRequired')}</span>}
    </div>
    {mode === 'source' ? <textarea data-testid="artifact-source-editor" aria-label={t('artifact.sourceEditor')} value={value}
      onChange={event => onChange(event.target.value)} className="h-full min-h-0 w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      : <div className="min-h-0 flex-1 overflow-auto p-4"><EditorBoundary fallback={fail}>
        <React.Suspense fallback={<span role="status">{t('common.loading')}</span>}>
          <RichEditor content={value} markdownEngine="official" editable={lossless} onReady={ready}
            onUpdate={text => { if (canWrite.current) onChange(text) }} />
        </React.Suspense>
      </EditorBoundary></div>}
  </div>
}
