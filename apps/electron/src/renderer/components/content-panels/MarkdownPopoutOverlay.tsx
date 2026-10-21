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
import { CodePreviewOverlay, ContentFrame, Markdown, PreviewOverlay } from '@phaneris/ui'
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

  if (popout.renderMode === 'source') {
    return (
      <CodePreviewOverlay
        isOpen
        onClose={close}
        content={popout.content}
        filePath="response.md"
        language="markdown"
        mode="read"
        theme={isDark ? 'dark' : 'light'}
      />
    )
  }

  return (
    <PreviewOverlay
      isOpen
      onClose={close}
      theme={isDark ? 'dark' : 'light'}
      typeBadge={{ icon: MessageSquare, label: t('contentPanel.preview.message'), variant: 'default' }}
      title={popout.title}
      className="bg-foreground-3"
    >
      <ContentFrame title={popout.title} maxWidth={960}>
        <div className="px-10 py-8 text-body">
          <Markdown mode="minimal" onUrlClick={onOpenUrl} onFileClick={onOpenFile}>{popout.content}</Markdown>
        </div>
      </ContentFrame>
    </PreviewOverlay>
  )
}
