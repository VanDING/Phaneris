/**
 * Connection rename dialog, extracted from AiSettingsPage.
 *
 * Three `useState` hooks and the two handlers that open and submit the dialog.
 * The open is deferred one frame on purpose: the dialog is launched from a
 * dropdown item, and opening it before that menu unmounts makes the focus
 * restore fight the menu's own teardown.
 *
 * Returns the page's original names so the JSX stays byte-identical.
 */
import { useCallback, useState } from 'react'
import type { LlmConnectionWithStatus } from '../../../shared/types'

export interface ConnectionRename {
  renameDialogOpen: boolean
  setRenameDialogOpen: (open: boolean) => void
  renamingConnection: { slug: string; name: string } | null
  renameValue: string
  setRenameValue: (value: string) => void
  handleRenameClick: (connection: LlmConnectionWithStatus) => void
  handleRenameSubmit: () => Promise<void>
}

export function useConnectionRename(refreshLlmConnections?: () => void): ConnectionRename {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingConnection, setRenamingConnection] = useState<{ slug: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleRenameClick = useCallback((connection: LlmConnectionWithStatus) => {
    setRenamingConnection({ slug: connection.slug, name: connection.name })
    setRenameValue(connection.name)
    // Defer dialog open to next frame to let dropdown fully unmount first
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingConnection || !window.electronAPI) return
    const trimmedName = renameValue.trim()
    if (!trimmedName || trimmedName === renamingConnection.name) {
      setRenameDialogOpen(false)
      return
    }
    try {
      // Get the full connection, update name, and save
      const connection = await window.electronAPI.getLlmConnection(renamingConnection.slug)
      if (connection) {
        const result = await window.electronAPI.saveLlmConnection({ ...connection, name: trimmedName })
        if (result.success) {
          refreshLlmConnections?.()
        } else {
          console.error('Failed to rename connection:', result.error)
        }
      }
    } catch (error) {
      console.error('Failed to rename connection:', error)
    }
    setRenameDialogOpen(false)
    setRenamingConnection(null)
    setRenameValue('')
  }, [renamingConnection, renameValue, refreshLlmConnections])

  return {
    renameDialogOpen,
    setRenameDialogOpen,
    renamingConnection,
    renameValue,
    setRenameValue,
    handleRenameClick,
    handleRenameSubmit,
  }
}
