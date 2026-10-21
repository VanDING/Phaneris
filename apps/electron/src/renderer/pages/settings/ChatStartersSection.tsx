/**
 * Chat starters editor (workspace settings).
 *
 * Three chips at most, each a label plus the prompt it sends. Saving goes through
 * the workspace settings RPC, which validates the payload itself — this form is a
 * convenience, not the enforcement point. Every failure path keeps the draft in
 * the inputs and shows the server's message, so a rejected save never looks like
 * a saved one.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextInput, type RichTextInputHandle } from '@/components/ui/rich-text-input'
import { InlineMentionMenu, useInlineMention, type MentionItem } from '@/components/ui/mention-menu'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import {
  MAX_CHAT_STARTERS,
  MAX_CHAT_STARTER_LABEL_LENGTH,
  MAX_CHAT_STARTER_PROMPT_LENGTH,
  type ChatStarter,
} from '@phaneris/shared/workspaces/chat-starters'

export interface ChatStartersSectionProps {
  workspaceId: string
  /** Announce a successful write so shells that cache settings reload. */
  onSaved?: () => void
}

export function ChatStartersSection({ workspaceId, onSaved }: ChatStartersSectionProps) {
  return <WorkspaceChatStarters key={workspaceId} workspaceId={workspaceId} onSaved={onSaved} />
}

function WorkspaceChatStarters({ workspaceId, onSaved }: ChatStartersSectionProps) {
  const { t } = useTranslation()
  const [starters, setStarters] = React.useState<ChatStarter[]>([])
  const [label, setLabel] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [readFailed, setReadFailed] = React.useState(false)
  const [reload, setReload] = React.useState(0)
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  const promptRef = React.useRef<RichTextInputHandle>(null)
  const writePending = React.useRef(false)
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const inlineMention = useInlineMention({ inputRef: promptRef, sources, skills, workspaceId, onSelect: () => {} })
  const selectMention = (item: MentionItem) => {
    const next = inlineMention.handleSelect(item)
    setPrompt(next.value.slice(0, MAX_CHAT_STARTER_PROMPT_LENGTH))
    promptRef.current?.setSelectionRange(next.cursorPosition, next.cursorPosition)
    inlineMention.close()
    promptRef.current?.focus()
  }

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReadFailed(false)
    setError(null)
    window.electronAPI.getWorkspaceSettings(workspaceId)
      .then((settings) => {
        if (cancelled) return
        setStarters((settings?.chatStarters ?? []) as ChatStarter[])
      })
      .catch((readError) => {
        if (cancelled) return
        setReadFailed(true)
        setError(readError instanceof Error ? readError.message : String(readError))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    void window.electronAPI.getSources(workspaceId).then(value => {
      if (!cancelled) setSources(Array.isArray(value) ? value : [])
    }).catch(() => {})
    void window.electronAPI.getSkills(workspaceId).then(value => {
      if (!cancelled) setSkills(Array.isArray(value) ? value : [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, reload])

  const save = async (next: ChatStarter[]): Promise<boolean> => {
    if (loading || readFailed || writePending.current) return false
    writePending.current = true
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.updateWorkspaceSetting(workspaceId, 'chatStarters', next)
      if (!mounted.current) return false
      setStarters(next)
      onSaved?.()
      return true
    } catch (saveError) {
      if (!mounted.current) return false
      // The server message is the useful one ("At most 3…", "empty prompt", …).
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    } finally {
      writePending.current = false
      if (mounted.current) setSaving(false)
    }
  }

  const add = async () => {
    const trimmedLabel = label.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedLabel || !trimmedPrompt) {
      setError(t('settings.workspace.chatStartersRequired'))
      return
    }
    if (starters.length >= MAX_CHAT_STARTERS) {
      setError(t('settings.workspace.chatStartersLimit', { count: MAX_CHAT_STARTERS }))
      return
    }
    const saved = await save([...starters, { label: trimmedLabel, prompt: trimmedPrompt }])
    // Clear only when the write actually landed, so a rejected add keeps the text.
    if (saved) {
      setLabel('')
      setPrompt('')
    }
  }

  const remove = async (index: number) => {
    await save(starters.filter((_starter, position) => position !== index))
  }

  const atLimit = starters.length >= MAX_CHAT_STARTERS
  const editDisabled = loading || readFailed || saving || atLimit

  return (
    <div className="space-y-3" data-testid="chat-starters-settings">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('common.loading')}
        </div>
      ) : starters.length === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="chat-starters-empty">
          {t('settings.workspace.chatStartersEmpty')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="chat-starters-list">
          {starters.map((starter, index) => (
            <li
              key={`${starter.label}:${index}`}
              data-testid="chat-starter-row"
              className="flex items-start justify-between gap-3 rounded-shape-lg bg-foreground/5 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{starter.label}</p>
                <p className="truncate text-xs text-text-secondary">{starter.prompt}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={saving}
                aria-label={t('settings.workspace.chatStartersRemove')}
                onClick={() => void remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <Input
          value={label}
          maxLength={MAX_CHAT_STARTER_LABEL_LENGTH}
          disabled={editDisabled}
          placeholder={t('settings.workspace.chatStartersLabelPlaceholder')}
          aria-label={t('settings.workspace.chatStartersLabelPlaceholder')}
          onChange={(event) => setLabel(event.target.value)}
          data-testid="chat-starter-label-input"
        />
        <RichTextInput
          ref={promptRef}
          value={prompt}
          sources={sources}
          skills={skills}
          workspaceId={workspaceId}
          disabled={editDisabled}
          placeholder={t('settings.workspace.chatStartersPromptPlaceholder')}
          aria-label={t('settings.workspace.chatStartersPromptPlaceholder')}
          className="craft-control craft-field-input min-h-16 rounded-shape-md px-3 py-2 text-sm"
          onChange={value => setPrompt(value.slice(0, MAX_CHAT_STARTER_PROMPT_LENGTH))}
          onInput={(value, cursor) => inlineMention.handleInputChange(value, cursor)}
          data-testid="chat-starter-prompt-input"
        />
        <InlineMentionMenu
          open={inlineMention.isOpen}
          onOpenChange={open => { if (!open) inlineMention.close() }}
          sections={inlineMention.sections}
          onSelect={selectMention}
          filter={inlineMention.filter}
          position={inlineMention.position}
          workspaceId={workspaceId}
          isSearching={inlineMention.isSearching}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary">
            {error
              ? <span className="text-destructive" data-testid="chat-starters-error">{error}</span>
              : t('settings.workspace.chatStartersHint', { count: starters.length, max: MAX_CHAT_STARTERS })}
          </p>
          {readFailed && (
            <Button type="button" variant="secondary" onClick={() => { setError(null); setReload(value => value + 1) }}>
              {t('common.retry')}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={editDisabled}
            onClick={() => void add()}
            data-testid="chat-starter-add"
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {t('settings.workspace.chatStartersAdd')}
          </Button>
        </div>
      </div>
    </div>
  )
}
