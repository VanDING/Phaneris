import * as React from 'react'
import { FileCode2, FileText, Folder } from 'lucide-react'
import { cn } from '../../lib/utils'
import { fileKind } from '../../lib/file-kind'

/**
 * The single mono file glyph. See `lib/file-kind.ts` for why there is exactly
 * one of these; colour identity lives in the Electron `FileTypeIcon`.
 *
 * Size is the caller's decision (`className="size-3"`), and the stroke comes
 * from `--icon-stroke-width` through `.lucide`, so a theme with lighter icons
 * (Ink, 1.4) moves this glyph too.
 */
export function FileKindIcon({ name, directory, className, ...props }: {
  /** File name or path; only the trailing segment is inspected. */
  name: string
  directory?: boolean
  className?: string
} & Omit<React.SVGProps<SVGSVGElement>, 'name'>) {
  const kind = fileKind(name, directory)
  const Icon = kind === 'folder' ? Folder : kind === 'code' ? FileCode2 : FileText
  return <Icon aria-hidden data-file-kind={kind} className={cn('shrink-0 text-muted-foreground', className)} {...props} />
}
