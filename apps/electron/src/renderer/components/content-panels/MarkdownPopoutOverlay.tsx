/**
 * MarkdownPopoutOverlay - read-only document pop-outs from the chat.
 *
 * Chat affordances (message pop-out, raw response, turn details, activity
 * details) used to push entries into a Files > Opened tab stack. Files now
 * owns exactly three jobs — browse, artifacts, changed — so a pop-out is
 * presented here, in the same overlay the link interceptor uses for files.
 */

import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { Markdown, PreviewOverlay } from '@phaneris/ui'
import { closeMarkdownPopoutAtom, markdownPopoutAtom } from '@/atoms/preview'

export function MarkdownPopoutOverlay({
  isDark,
  onOpenUrl,
  onOpenFile,
}: {
  isDark: boolean
  onOpenUrl?: (url: string) => void
  onOpenFile?: (path: string) => void
}) {
  const { t } = useTranslation()
  const popout = useAtomValue(markdownPopoutAtom)
  const close = useSetAtom(closeMarkdownPopoutAtom)

  if (!popout) return null

  return (
    <PreviewOverlay
      isOpen
      onClose={close}
      theme={isDark ? 'dark' : 'light'}
      typeBadge={{ icon: MessageSquare, label: t('contentPanel.preview.message'), variant: 'default' }}
      title={popout.title}
    >
      <div className="h-full overflow-auto px-4 py-3">
        <Markdown children={popout.content} onUrlClick={onOpenUrl} onFileClick={onOpenFile} />
      </div>
    </PreviewOverlay>
  )
}
