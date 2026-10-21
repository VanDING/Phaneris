/**
 * Image-generation settings, extracted from AiSettingsPage.
 *
 * Four `useState` hooks plus a retry counter, the load effect (which re-runs when
 * the connection list changes or the user retries) and the save handler. The
 * "add a connection" action deliberately stays in the page: it drives the shared
 * API-setup overlay, which is not part of this domain.
 *
 * Returns the page's original names so the JSX stays byte-identical.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ImageGenerationSettings, ImageGenerationStatus } from '../../../shared/types'

export interface ImageSettings {
  imageStatus: ImageGenerationStatus | null
  imageConfigurationOpen: boolean
  setImageConfigurationOpen: (open: boolean) => void
  savingImages: boolean
  imageSettingsError: string | null
  setImageRetry: React.Dispatch<React.SetStateAction<number>>
  saveImageSettings: (settings: ImageGenerationSettings) => Promise<void>
}

export function useImageSettings(refreshToken: unknown): ImageSettings {
  const [imageStatus, setImageStatus] = useState<ImageGenerationStatus | null>(null)
  const [imageConfigurationOpen, setImageConfigurationOpen] = useState(false)
  const [savingImages, setSavingImages] = useState(false)
  const [imageSettingsError, setImageSettingsError] = useState<string | null>(null)
  const [imageRetry, setImageRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (typeof window.electronAPI.getImageGenerationSettings !== 'function') return
    window.electronAPI.getImageGenerationSettings().then(status => {
      if (!cancelled) { setImageStatus(status); setImageSettingsError(null) }
    }).catch(error => { if (!cancelled) setImageSettingsError(String(error)) })
    return () => { cancelled = true }
    // `refreshToken` re-reads after the connection list changes; `imageRetry` is
    // the explicit retry from the error row.
  }, [refreshToken, imageRetry])

  const saveImageSettings = useCallback(async (settings: ImageGenerationSettings) => {
    setSavingImages(true)
    try { setImageStatus(await window.electronAPI.setImageGenerationSettings(settings)); setImageSettingsError(null) }
    catch (error) { setImageSettingsError(error instanceof Error ? error.message : String(error)) }
    finally { setSavingImages(false) }
  }, [])

  return {
    imageStatus,
    imageConfigurationOpen,
    setImageConfigurationOpen,
    savingImages,
    imageSettingsError,
    setImageRetry,
    saveImageSettings,
  }
}
