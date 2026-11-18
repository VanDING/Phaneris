import { useId, useRef, useState, type ReactNode } from 'react'
import { ImageIcon, PenLine, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip, TooltipTrigger, TooltipContent } from '@phaneris/ui'
import { RESOURCE_ICON_IMAGE_SIZE, RESOURCE_ICON_PRESETS, type ResourceIcon } from '@phaneris/shared/resources/icons'
import { saveResourceIcon, useResourceIcon } from '@/lib/resource-icons'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { resourceIconGlyphs } from './resource-icon-artwork'

const PRESET_LABELS = {
  'file-text': 'resourceIcon.presetDocument',
  'book-open': 'resourceIcon.presetReading',
  'chart-pie': 'resourceIcon.presetAnalysis',
  'pen-line': 'resourceIcon.presetWriting',
  'scan-line': 'resourceIcon.presetReview',
  compass: 'resourceIcon.presetResearch',
  database: 'resourceIcon.presetData',
  globe: 'resourceIcon.presetWeb',
  folder: 'resourceIcon.presetFiles',
  layers: 'resourceIcon.presetDesign',
  'code-xml': 'resourceIcon.presetCode',
  zap: 'resourceIcon.presetQuick',
} as const

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'])

interface ResourceIconEditorProps {
  workspaceId: string
  iconKey: string
  renderIcon: (icon: ResourceIcon | null) => ReactNode
  compact?: boolean
  selected?: boolean
}

export function ResourceIconEditor({ workspaceId, iconKey, renderIcon, compact, selected }: ResourceIconEditorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { icon, phase } = useResourceIcon(workspaceId, iconKey)
  const titleId = useId()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button type="button" aria-label={t('resourceIcon.change')} className={cn(
                'craft-icon-button craft-row-actions resource-icon-row-trigger inline-flex size-7 items-center justify-center text-text-secondary hover:bg-foreground/10 data-[state=open]:bg-foreground/10',
                !selected && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100',
              )}>
                <PenLine className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('resourceIcon.change')}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <ImageIcon className="size-3.5" />
            {t('resourceIcon.change')}
          </Button>
        </PopoverTrigger>
      )}
      {open && (
        <PopoverContent align={compact ? 'end' : 'start'} sideOffset={7} aria-labelledby={titleId}
          className="resource-icon-editor w-[360px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
          <h3 id={titleId} className="mb-3 text-body font-medium">{t('resourceIcon.change')}</h3>
          {phase === 'ready' ? (
            <ResourceIconPicker key={JSON.stringify([workspaceId, iconKey])} initialIcon={icon ?? null} renderIcon={renderIcon}
              onCancel={() => setOpen(false)}
              onApply={async draft => {
                await saveResourceIcon(workspaceId, iconKey, draft)
                setOpen(false)
              }} />
          ) : (
            <p className="text-label text-text-secondary" role={phase === 'error' ? 'alert' : 'status'}>
              {phase === 'error' ? t('resourceIcon.loadFailed') : t('common.loading')}
            </p>
          )}
        </PopoverContent>
      )}
    </Popover>
  )
}

function ResourceIconPicker({ initialIcon, renderIcon, onCancel, onApply }: {
  initialIcon: ResourceIcon | null
  renderIcon: ResourceIconEditorProps['renderIcon']
  onCancel: () => void
  onApply: (icon: ResourceIcon | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialIcon)
  const [tab, setTab] = useState<'preset' | 'image'>(initialIcon?.kind === 'image' ? 'image' : 'preset')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setError('')
    if (!SUPPORTED_IMAGE_TYPES.has(file.type) || file.size > MAX_UPLOAD_BYTES) {
      setError(t('resourceIcon.imageInvalid'))
      return
    }
    const url = URL.createObjectURL(file)
    setBusy(true)
    try {
      // Decode SVG as an image and save only pixels. No user markup is inserted.
      const image = new Image()
      image.src = url
      await image.decode()
      const factor = Math.min(RESOURCE_ICON_IMAGE_SIZE / Math.max(image.naturalWidth, image.naturalHeight), 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * factor))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * factor))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      setDraft({ kind: 'image', src: canvas.toDataURL('image/png') })
      setFileName(file.name)
    } catch {
      setError(t('resourceIcon.imageUnreadable'))
    } finally {
      URL.revokeObjectURL(url)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3" aria-busy={busy}>
      <div className="flex gap-1 border-b border-border pb-2" role="group" aria-label={t('resourceIcon.change')}>
        <Button size="sm" variant={tab === 'preset' ? 'secondary' : 'ghost'} aria-pressed={tab === 'preset'}
          disabled={busy} onClick={() => { setTab('preset'); setError('') }}>{t('resourceIcon.builtIn')}</Button>
        <Button size="sm" variant={tab === 'image' ? 'secondary' : 'ghost'} aria-pressed={tab === 'image'}
          disabled={busy} onClick={() => { setTab('image'); setError('') }}>{t('resourceIcon.upload')}</Button>
      </div>
      {tab === 'preset' ? (
        <div className="resource-icon-palette grid grid-cols-6 gap-1">
          {RESOURCE_ICON_PRESETS.map(name => {
            const Glyph = resourceIconGlyphs[name]
            const label = t(PRESET_LABELS[name])
            const pressed = draft?.kind === 'preset' && draft.name === name
            return (
              <Tooltip key={name}>
                <TooltipTrigger asChild>
                  <Button size="sm" variant={pressed ? 'outline' : 'ghost'} aria-pressed={pressed}
                    aria-label={label} disabled={busy} className="min-w-0 px-0"
                    onClick={() => { setDraft({ kind: 'preset', name }); setError('') }}>
                    <Glyph className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <input ref={fileInput} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="craft-field" hidden
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void upload(file)
            }} />
          <Button variant="outline" className="w-full" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />{t('resourceIcon.chooseImage')}
          </Button>
          <p className="break-words text-label text-text-secondary">{fileName || t('resourceIcon.imageFormats')}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-label text-text-secondary">
        <div className="flex items-center gap-2"><div className="resource-icon-list" aria-hidden="true">{renderIcon(draft)}</div>{t('resourceIcon.listPreview')}</div>
        <div className="flex items-center gap-2"><div className="resource-icon-detail text-foreground" aria-hidden="true">{renderIcon(draft)}</div>{t('resourceIcon.detailPreview')}</div>
      </div>
      {error && <p role="alert" className="text-label text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Button size="sm" variant="ghost" disabled={busy || draft === null}
          onClick={() => { setDraft(null); setTab('preset'); setFileName(''); setError('') }}>{t('resourceIcon.restore')}</Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={busy || draft === initialIcon} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onApply(draft)
            } catch {
              setError(t('resourceIcon.saveFailed'))
            } finally {
              setBusy(false)
            }
          }}>{t('resourceIcon.apply')}</Button>
        </div>
      </div>
    </div>
  )
}
