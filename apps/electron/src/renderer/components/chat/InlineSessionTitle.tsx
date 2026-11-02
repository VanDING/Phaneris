import * as React from 'react'
import { useTranslation } from 'react-i18next'

export function InlineSessionTitle({ title, editing, onEditingChange, onRename }: {
  title: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (title: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState(title)
  const input = React.useRef<HTMLInputElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const finishing = React.useRef(false)
  const latestTitle = React.useRef(title)
  latestTitle.current = title

  React.useEffect(() => {
    if (!editing) return
    finishing.current = false
    setDraft(latestTitle.current)
    input.current?.focus()
    const frame = requestAnimationFrame(() => input.current?.select())
    return () => cancelAnimationFrame(frame)
  }, [editing])

  const finish = (cancel: boolean, restoreFocus = false) => {
    if (finishing.current) return
    finishing.current = true
    const value = draft.trim()
    onEditingChange(false)
    if (!cancel && value && value !== title) onRename(value)
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus())
  }

  return editing ? (
    <input
      ref={input}
      aria-label={t('chat.renameSession')}
      className="craft-control titlebar-no-drag min-w-0 w-full px-2 py-1 text-body font-semibold"
      value={draft}
      maxLength={180}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => finish(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); finish(false, true) }
        if (event.key === 'Escape') { event.preventDefault(); finish(true, true) }
      }}
    />
  ) : (
    <button
      ref={trigger}
      type="button"
      className="craft-control titlebar-no-drag max-w-full min-w-0 truncate rounded-shape-sm px-2 py-1 text-body font-semibold text-left hover:bg-foreground/3"
      onClick={() => onEditingChange(true)}
    >{title}</button>
  )
}
