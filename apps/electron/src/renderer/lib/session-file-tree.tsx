/**
 * SessionFileTree - presentational tree for session-file listings.
 *
 * Extracted from the right-sidebar section so the Files > Browse view can be
 * one tree with several collapsible roots (working directory + session folder)
 * while keeping identical row geometry, hover behavior, context menu, and
 * expand animation. Consumers own loading, watching, and expansion state.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from 'motion/react'
import { File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight, ExternalLink, Copy } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { SessionFile, SessionFileScope } from '../../shared/types'
export type { SessionFile, SessionFileScope }
import { MOTION_DURATION, MOTION_EASE, motionTween } from '@phaneris/ui/motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getFileManagerName } from '@/lib/platform'

/**
 * Stagger animation variants for child items - matches LeftSidebar pattern
 * Rows reveal together so large folders do not accumulate entry delays
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0,
      delayChildren: 0,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0,
      staggerDirection: -1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: MOTION_DURATION.standard, ease: MOTION_EASE.enter },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Prune a file tree to entries matching a case-insensitive filename query.
 * Directories are kept when they (transitively) contain a match, so the path
 * to every match stays navigable. Pure — returns a shallow-pruned copy only
 * for nodes that survived.
 */
export function filterFileTree(entries: SessionFile[], query: string): SessionFile[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries

  const matches = (file: SessionFile): boolean => file.name.toLowerCase().includes(needle)

  const visit = (items: SessionFile[]): SessionFile[] => {
    const kept: SessionFile[] = []
    for (const item of items) {
      if (item.type === 'directory' && item.children) {
        const keptChildren = visit(item.children)
        if (matches(item) || keptChildren.length > 0) {
          kept.push({ ...item, children: keptChildren })
        }
      } else if (matches(item)) {
        kept.push(item)
      }
    }
    return kept
  }

  return visit(entries)
}

/** Collect all directory paths recursively so the tree can start fully expanded. */
export function collectDirectoryPaths(entries: SessionFile[]): string[] {
  const directories: string[] = []
  const visit = (items: SessionFile[]) => {
    for (const item of items) {
      if (item.type === 'directory') {
        directories.push(item.path)
        if (item.children && item.children.length > 0) {
          visit(item.children)
        }
      }
    }
  }
  visit(entries)
  return directories
}

/**
 * Remove the entries a caller renders separately (e.g. attachments pinned above
 * the tree). Directories left empty by the removal disappear too, so a stripped
 * `attachments/` folder does not linger as an empty node.
 */
export function omitFileTreePaths(entries: SessionFile[], paths: ReadonlySet<string>): SessionFile[] {
  if (paths.size === 0) return entries
  const visit = (items: SessionFile[]): SessionFile[] => {
    const kept: SessionFile[] = []
    for (const item of items) {
      if (paths.has(item.path)) continue
      if (item.type === 'directory' && item.children) {
        const children = visit(item.children)
        if (children.length === 0) continue
        kept.push({ ...item, children })
      } else {
        kept.push(item)
      }
    }
    return kept
  }
  return visit(entries)
}

/** Normalize a path for cross-source comparison (attachments vs scanned tree). */
export function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Get icon for file based on name/type (14x14px matching sidebar)
 */
export function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = "h-3.5 w-3.5 text-muted-foreground"

  if (file.type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    return <FileText className={iconClass} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
    return <Image className={iconClass} />
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }

  return <File className={iconClass} />
}

export interface SessionFilesSectionProps {
  sessionId?: string
  className?: string
  /** Which authoritative root to browse. Info uses session; Files uses working. */
  fileScope?: SessionFileScope
  /** Root identity used to restart loading and watching when it changes. */
  rootPath?: string
  /** Absolute session folder path for header actions (e.g. View in Finder) */
  sessionFolderPath?: string
  /** Hide section header when embedded inside compact containers (e.g. popovers) */
  hideHeader?: boolean
  /** Case-insensitive filename filter (empty = no filtering). Directory
   *  ancestors of matches are kept so the tree path stays navigable. */
  filterQuery?: string
}

export interface FileTreeNodeProps {
  file: SessionFile
  depth: number
  selectedPath?: string
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onFileDoubleClick: (file: SessionFile) => void
  onRevealInFileManager: (path: string) => void
  /** Whether this item is inside an expanded folder (for stagger animation) */
  isNested?: boolean
  /** Render a root row: medium weight, always shows its folder icon. */
  isRoot?: boolean
  /** Override the leading icon (e.g. a paperclip for pinned attachments). */
  icon?: React.ReactNode
  /** Per-row icon override; takes precedence over `icon` and the type icon. */
  iconForPath?: (path: string) => React.ReactNode
}

/**
 * Recursive file tree item component
 * Matches LeftSidebar styling patterns exactly:
 * - Vertical line on container level (not per-item)
 * - Framer-motion staggered animation for expand/collapse
 * - Chevron shown on hover, icon hidden
 */
export function FileTreeNode({
  file,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  onFileDoubleClick,
  onRevealInFileManager,
  isNested,
  isRoot,
  icon,
  iconForPath,
}: FileTreeNodeProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotionConfig()
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  // Roots are always expandable (their children may still be loading or
  // filtered away); nested folders keep the "only if it has content" rule.
  const hasChildren = isDirectory && (isRoot === true || (file.children?.length ?? 0) > 0)
  const isSelected = !isDirectory && selectedPath === file.path

  const handleClick = () => {
    if (isRoot) {
      onToggleExpand(file.path)
    } else if (isDirectory && hasChildren) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleDoubleClick = () => {
    onFileDoubleClick(file)
  }

  // Handle chevron click separately to toggle expand
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasChildren) {
      onToggleExpand(file.path)
    }
  }

  // The button element for the file/folder item
  const buttonElement = (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        // Base styles matching LeftSidebar exactly
        // min-w-0 and overflow-hidden required for truncation to work in grid context
        "group relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg py-1.5 text-left text-[13px] select-none outline-none",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "transition-[background-color,color,transform] hover:bg-sidebar-hover active:scale-[0.995]",
        isSelected && "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/15",
        isRoot && "font-medium",
        // Same padding for all items - nested indentation handled by container
        "px-2"
      )}
      aria-expanded={hasChildren ? isExpanded : undefined}
      title={`${file.path}\n${file.type === 'file' ? formatFileSize(file.size) : 'Directory'}\n\nClick to ${hasChildren ? 'expand' : 'preview'}, double-click to open externally`}
    >
      {isSelected && (
        <motion.span
          className="absolute inset-y-1 left-0 w-0.5 origin-center rounded-r bg-accent"
          initial={{ opacity: 0, scaleY: 0.4 }}
          animate={{ opacity: 1, scaleY: 1 }}
        />
      )}
      {/* Icon row — persistent chevron for expandable items, alignment slot
          for plain files so every row lines up. */}
      <span className="flex h-3.5 shrink-0 items-center gap-0.5">
        {hasChildren ? (
          <span
            className="flex h-3 w-3 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={handleChevronClick}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                isExpanded && "rotate-90"
              )}
            />
          </span>
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {iconForPath?.(file.path)
            ?? icon
            ?? (isRoot ? getFileIcon({ ...file, type: 'directory' }, isExpanded) : getFileIcon(file, isExpanded))}
        </span>
      </span>

      {/* File/folder name - min-w-0 required for truncate to work in flex container */}
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
      {file.type === 'file' && file.size !== undefined && (
        <span className={cn('shrink-0 text-[10px] tabular-nums text-muted-foreground/45 transition-opacity', !isSelected && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}>
          {formatFileSize(file.size)}
        </span>
      )}
    </button>
  )

  const fileManagerName = getFileManagerName()

  // Inner content: button and expandable children (wrapped in group/section like LeftSidebar)
  const innerContent = (
    <div className="group/section min-w-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonElement}
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          {/* Open — files only (folders just show "Show in file manager") */}
          {file.type !== 'directory' && (
            <StyledContextMenuItem onSelect={() => onFileClick(file)}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t("chat.openFile")}
            </StyledContextMenuItem>
          )}
          {/* Copy path */}
          <StyledContextMenuItem
            onSelect={() => {
              navigator.clipboard.writeText(file.path).then(
                () => toast.success(t('toast.pathCopied')),
                () => toast.error(t('toast.copyFailed')),
              )
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('common.copyPath')}
          </StyledContextMenuItem>
          {/* Show in file manager */}
          <StyledContextMenuItem
            onSelect={() => onRevealInFileManager(file.path)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("chat.showInFileManager", { fileManager: fileManagerName })}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>
      {/* Expandable children with framer-motion animation - matches LeftSidebar exactly */}
      {hasChildren && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={motionTween(reduceMotion, 'standard', 'move')}
              className="overflow-hidden"
            >
              {/* Wrapper div matches LeftSidebar recursive structure - min-w-0 allows shrinking */}
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {/* Vertical line at container level - matches LeftSidebar pattern */}
                  <div
                    className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
                    aria-hidden="true"
                  />
                  {file.children!.map((child) => (
                    <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                      <FileTreeNode
                        file={child}
                        depth={depth + 1}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        onToggleExpand={onToggleExpand}
                        onFileClick={onFileClick}
                        onFileDoubleClick={onFileDoubleClick}
                        onRevealInFileManager={onRevealInFileManager}
                        isNested={true}
                        iconForPath={iconForPath}
                      />
                    </motion.div>
                  ))}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )

  // For nested items, the parent already wraps in motion.div for stagger
  // Root items use Fragment to avoid extra wrapper (matches LeftSidebar exactly)
  return <>{innerContent}</>
}
