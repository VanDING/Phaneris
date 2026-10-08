import type { DecisionLayerFeature } from '@phaneris/shared/decisions/settings'
import type { DecisionUsageReport } from '@phaneris/shared/decisions'
import { DECISION_SETTINGS_CHANGED_EVENT, guardedModeAvailableAtom } from "@/atoms/permission-modes"
/**
 * AiSettingsPage
 *
 * Unified AI settings page that consolidates all LLM-related configuration:
 * - Default connection, model, and thinking level
 * - Current workspace link (overrides are edited in Workspace settings)
 * - Connection management (add/edit/delete)
 *
 * Connections → conversation → independently expandable advanced settings.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_SETTINGS_FOCUS_KEY, AI_SETTINGS_FOCUS_EVENT } from '@/lib/ai-settings-navigation'
import { supportsNativeImageGeneration } from '@config/image-generation'
import type { ImageGenerationSettings, ImageGenerationStatus } from '../../../shared/types'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { navigate, routes } from '@/lib/navigate'
import { getModelOptionsForConnection, connectionImageUnderstanding } from '@/lib/ai-model-options'
import { SettingsDisclosure } from '@/components/settings/SettingsDisclosure'
import { X, MoreHorizontal, Pencil, Trash2, Star, ChevronRight, CheckCircle2, AlertTriangle, RefreshCcw, Settings2, MessageSquareMore, Zap, Clock, Check } from 'lucide-react'
import type { CredentialHealthStatus, CredentialHealthIssue } from '../../../shared/types'
import { Spinner, FullscreenOverlayBase, Tooltip, TooltipTrigger, TooltipContent } from '@phaneris/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { LlmConnectionWithStatus, ThinkingLevel, WorkspaceSettings } from '../../../shared/types'
import type { DecisionLayerStatus, DecisionLayerSettingsPatch, DecisionProviderId, DecisionServerProbe, DecisionTestResult } from '../../../shared/types'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@phaneris/shared/agent/thinking-levels'
import { type ContextPolicy } from '@phaneris/shared/agent/context-policy'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  DropdownMenuSub,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsMenuSelectRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import { useOnboarding } from '@/hooks/useOnboarding'
import { RtkUpdateDialog, type RtkStatusInfo } from '@/components/RtkUpdateDialog'
import { OnboardingWizard, type ApiSetupMethod } from '@/components/onboarding'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { getModelShortName, type ModelDefinition } from '@config/models'
import { resolveMidStreamBehavior, type CustomEndpointApi, type MidStreamBehavior } from '@config/llm-connections'
import { toast } from 'sonner'

/**
 * Compact token count: 1234 → "1.2K", 1234567 → "1.2M". Used by the RTK
 * efficiency meter. Locale-agnostic — the suffix is universal across the
 * 7 supported locales.
 */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

// ============================================
// Credential Health Warning Banner
// ============================================

/** Get user-friendly message for credential health issue */
function getHealthIssueMessage(issue: CredentialHealthIssue, t: (key: string) => string): string {
  switch (issue.type) {
    case 'file_corrupted':
      return t("settings.ai.credentialCorrupted")
    case 'decryption_failed':
      return t("settings.ai.credentialOtherMachine")
    case 'no_default_credentials':
      return t("settings.ai.credentialNotFound")
    default:
      return issue.message || 'Credential issue detected.'
  }
}

interface CredentialHealthBannerProps {
  issues: CredentialHealthIssue[]
  onReauthenticate: () => void
}

function CredentialHealthBanner({ issues, onReauthenticate }: CredentialHealthBannerProps) {
  const { t } = useTranslation()
  if (issues.length === 0) return null

  return (
    <div className="rounded-lg border border-info/30 bg-info/10 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-info flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-info">
            {t("settings.ai.credentialIssue")}
          </h4>
          <p className="mt-1 text-sm text-info-text">
            {getHealthIssueMessage(issues[0], t)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReauthenticate}
          className="flex-shrink-0 border-amber-500/30 text-info hover:bg-amber-500/10"
        >
          {t("settings.ai.reAuthenticate")}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Pi Auth Provider Display Names
// ============================================

// ============================================
// Connection Row Component
// ============================================

type ValidationState = 'idle' | 'validating' | 'success' | 'error'

interface ConnectionRowProps {
  connection: LlmConnectionWithStatus
  usedForImages?: boolean
  isLastConnection: boolean
  onRenameClick: () => void
  onDelete: () => void
  onSetDefault: () => void
  onValidate: () => void
  onReauthenticate: () => void
  onEdit: () => void
  onSetMidStreamBehavior: (behavior: MidStreamBehavior) => void
  validationState: ValidationState
  validationError?: string
  /** True when another OAuth connection resolves to the same Anthropic account (issue #838) */
  isDuplicateAccount?: boolean
}

function ConnectionRow({ connection, usedForImages, isLastConnection, onRenameClick, onDelete, onSetDefault, onValidate, onReauthenticate, onEdit, onSetMidStreamBehavior, validationState, validationError, isDuplicateAccount }: ConnectionRowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Opening dialog/overlay flows directly from a dropdown item can race with
  // menu teardown and leave a transient interaction lock behind on some systems.
  // Force menu close first, then trigger action on next frame.
  const runAfterMenuClose = useCallback((action: () => void) => {
    setMenuOpen(false)
    requestAnimationFrame(() => {
      action()
    })
  }, [])

  const imageUnderstanding = connectionImageUnderstanding(connection)
  const capabilities = [t("settings.ai.capabilityChat"),
    imageUnderstanding === 'all' ? t("settings.ai.capabilityImageInput") : imageUnderstanding === 'some' ? t("settings.ai.capabilityImageInputSome") : null,
    supportsNativeImageGeneration(connection) ? t("settings.ai.capabilityImageGeneration") : null,
  ].filter(Boolean)
  const identity = connection.authType === 'oauth' && connection.oauthAccountEmail
    ? [connection.oauthAccountEmail, connection.oauthOrganizationName].filter(Boolean).join(' · ') : null
  const validation = validationState === 'validating' ? t("settings.ai.validating")
    : validationState === 'success' ? t("settings.ai.connectionValid")
    : validationState === 'error' ? validationError || t("settings.ai.validationFailed")
    : !connection.isAuthenticated ? t("settings.ai.notAuthenticated") : null
  const description = [...capabilities, identity, validation].filter(Boolean).join(' · ')

  return (
    <div data-connection-slug={connection.slug}><SettingsRow
      label={(
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ConnectionIcon connection={connection} size={14} />
            <span>{connection.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{connection.authType === 'oauth' ? t("settings.ai.authSubscription") : t("settings.ai.authApiKey")}</span>
            {connection.isDefault && (
              <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-[4px] bg-background shadow-minimal text-foreground/60">
                {t("settings.ai.defaultConversationUse")}
              </span>
            )}
            {usedForImages && <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-[4px] bg-background shadow-minimal text-foreground/60">{t("settings.ai.imageGenerationUse")}</span>}
            {isDuplicateAccount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center" aria-label={t("settings.ai.duplicateAccount")}>
                    <AlertTriangle className="h-3.5 w-3.5 text-info" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("settings.ai.duplicateAccount")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      description={description}
    >
      <DropdownMenu modal={false} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05] transition-colors"
            data-state={menuOpen ? 'open' : 'closed'}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onRenameClick)}>
            <Pencil className="h-3.5 w-3.5" />
            <span>{t("common.rename")}</span>
          </StyledDropdownMenuItem>
          {!connection.isDefault && (
            <StyledDropdownMenuItem onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              <span>{t("settings.ai.setAsDefault")}</span>
            </StyledDropdownMenuItem>
          )}
          {connection.authType === 'oauth' ? (
            <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onReauthenticate)}>
              <RefreshCcw className="h-3.5 w-3.5" />
              <span>{t("settings.ai.reAuthenticate")}</span>
            </StyledDropdownMenuItem>
          ) : (
            <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onEdit)}>
              <Settings2 className="h-3.5 w-3.5" />
              <span>{t("common.edit")}</span>
            </StyledDropdownMenuItem>
          )}
          <StyledDropdownMenuItem
            onClick={onValidate}
            disabled={validationState === 'validating'}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t("settings.ai.validateConnection")}</span>
          </StyledDropdownMenuItem>
          {(() => {
            const currentBehavior = resolveMidStreamBehavior(connection)
            return (
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <MessageSquareMore className="h-3.5 w-3.5" />
                  <span>{t("settings.ai.midStream.title")}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => onSetMidStreamBehavior('steer')}>
                    <Zap className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("settings.ai.midStream.steer")}</span>
                    {currentBehavior === 'steer' && <Check className="h-3.5 w-3.5" />}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => onSetMidStreamBehavior('queue')}>
                    <Clock className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("settings.ai.midStream.queue")}</span>
                    {currentBehavior === 'queue' && <Check className="h-3.5 w-3.5" />}
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })()}
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={onDelete}
            variant="destructive"
            disabled={isLastConnection}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("common.delete")}</span>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </SettingsRow></div>
  )
}

// ============================================
// Helpers
// ============================================

/** Map a connection's provider type to the corresponding API key setup method. */
function getApiKeyMethodForConnection(conn: LlmConnectionWithStatus): ApiSetupMethod {
  const provider = conn.providerType || conn.type
  if (provider === 'pi' || provider === 'pi_compat') return 'pi_api_key'
  return 'anthropic_api_key'
}

// ============================================
// Main Component
// ============================================

export default function AiSettingsPage() {
  const { t, i18n } = useTranslation()
  const { llmConnections, refreshLlmConnections, activeWorkspaceId, workspaces } = useAppShellContext()

  const [decisionConfigurationOpen, setDecisionConfigurationOpen] = useState(() => sessionStorage.getItem(AI_SETTINGS_FOCUS_KEY) === 'decisions')
  const [decisionUsage, setDecisionUsage] = useState<DecisionUsageReport | null>(null)
  const [decisionUsageError, setDecisionUsageError] = useState(false)
  const [decisionUsageRetry, setDecisionUsageRetry] = useState(0)
  const decisionUsageGeneration = useRef(0)
  useEffect(() => window.electronAPI?.onTransportConnectionStateChanged?.(() => {
    decisionUsageGeneration.current++
    setDecisionUsageRetry(n => n + 1)
  }), [])
  useEffect(() => {
    let current = true
    const generation = ++decisionUsageGeneration.current
    setDecisionUsage(null)
    setDecisionUsageError(false)
    if (!decisionConfigurationOpen) return
    if (typeof window.electronAPI?.getDecisionUsage !== 'function') { setDecisionUsageError(true); return }
    window.electronAPI.getDecisionUsage().then(report => {
      if (current && generation === decisionUsageGeneration.current) setDecisionUsage(report)
    }).catch(() => { if (current && generation === decisionUsageGeneration.current) setDecisionUsageError(true) })
    return () => { current = false }
  }, [decisionConfigurationOpen, activeWorkspaceId, decisionUsageRetry])
  const [imageStatus, setImageStatus] = useState<ImageGenerationStatus | null>(null)
  const [imageConfigurationOpen, setImageConfigurationOpen] = useState(false)
  const [savingImages, setSavingImages] = useState(false)
  const [imageSettingsError, setImageSettingsError] = useState<string | null>(null)

  // API Setup overlay state
  const [showApiSetup, setShowApiSetup] = useState(false)
  const [editingConnectionSlug, setEditingConnectionSlug] = useState<string | null>(null)
  const [isDirectEdit, setIsDirectEdit] = useState(false)
  const [editInitialValues, setEditInitialValues] = useState<{
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    utilityModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  } | undefined>(undefined)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const setGuardedAvailable = useSetAtom(guardedModeAvailableAtom)

  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState(false)
  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId)
  useEffect(() => {
    let cancelled = false
    setWorkspaceSettings(null); setWorkspaceLoadError(false)
    if (activeWorkspaceId) window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then(settings => {
      if (!cancelled) { setWorkspaceSettings(settings); setWorkspaceLoadError(!settings) }
    }).catch(() => { if (!cancelled) setWorkspaceLoadError(true) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, llmConnections])

  // Default settings state (app-level)
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [extendedPromptCache, setExtendedPromptCache] = useState(false)
  const [savingExtendedCache, setSavingExtendedCache] = useState(false)
  const [performanceOpen, setPerformanceOpen] = useState(false)
  const [imageConnectionSetup, setImageConnectionSetup] = useState(false)
  const [promptCacheWarming, setPromptCacheWarming] = useState(false)
  const [savingCacheWarming, setSavingCacheWarming] = useState(false)
  const [contextPolicy, setContextPolicy] = useState<ContextPolicy>('compact')
  const [savingContextPolicy, setSavingContextPolicy] = useState(false)
  const contextPolicyOptions = [
    { value: 'compact', label: t("settings.ai.context.autoCompact"), description: t("settings.ai.context.autoCompactDesc") },
    { value: 'handoff', label: t("settings.ai.context.autoHandoff"), description: t("settings.ai.context.autoHandoffDesc") },
    { value: 'manual', label: t("settings.ai.context.manual"), description: t("settings.ai.context.manualDesc") },
  ]
  const [rtkEnabled, setRtkEnabled] = useState(false)
  const [savingRtk, setSavingRtk] = useState(false)
  const [rtkStatus, setRtkStatus] = useState<RtkStatusInfo | null>(null)
  const [rtkRechecking, setRtkRechecking] = useState(false)
  const [rtkUpdateOpen, setRtkUpdateOpen] = useState(false)
  const [rtkGain, setRtkGain] = useState<{ totalCommands: number; totalInput: number; totalOutput: number; totalSaved: number; avgSavingsPct: number; totalTimeMs: number; avgTimeMs: number } | null>(null)

  // Decision model (Jev / TypeSafe System One) — opt-in decision layer.
  // The card is always shown; everything behind it stays off until the user enables it.
  const [decisionLoadError, setDecisionLoadError] = useState<string | null>(null)
  const [savingDecisions, setSavingDecisions] = useState(false)
  const [decisionStatus, setDecisionStatus] = useState<DecisionLayerStatus | null>(null)
  const [decisionKeyDraft, setDecisionKeyDraft] = useState('')
  const [decisionModelDraft, setDecisionModelDraft] = useState('')
  const [decisionBaseUrlDraft, setDecisionBaseUrlDraft] = useState('')
  const [decisionTesting, setDecisionTesting] = useState(false)
  const [decisionTestResult, setDecisionTestResult] = useState<DecisionTestResult | null>(null)
  // Local servers (Laya, custom): GET /health so the card can say whether the server is up.
  const [decisionProbe, setDecisionProbe] = useState<DecisionServerProbe | null>(null)
  const [decisionProbing, setDecisionProbing] = useState(false)
  // Drafts are seeded from stored settings once (and after a provider switch),
  // never on background refreshes, so in-progress typing is not clobbered.
  const decisionDraftsSeededRef = useRef(false)

  // Validation state per connection
  const [validationStates, setValidationStates] = useState<Record<string, {
    state: ValidationState
    error?: string
  }>>({})

  // Credential health state (for startup warning banner)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingConnection, setRenamingConnection] = useState<{ slug: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Load workspaces, default settings, and credential health
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const defaultThinkingLevel = await window.electronAPI.getDefaultThinkingLevel()
        setDefaultThinking(defaultThinkingLevel)

        const extendedCache = await window.electronAPI.getExtendedPromptCache()
        setExtendedPromptCache(extendedCache)
        setPromptCacheWarming(await window.electronAPI.getPromptCacheWarming())
        setContextPolicy(await window.electronAPI.getContextPolicy())


        const rtkOn = await window.electronAPI.getRtkEnabled()
        setRtkEnabled(rtkOn)

        const status = await window.electronAPI.getRtkStatus()
        setRtkStatus(status)

        // Check credential health for potential issues (corruption, machine migration)
        const health = await window.electronAPI.getCredentialHealth()
        if (!health.healthy) {
          setCredentialHealthIssues(health.issues)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    load()
  }, [activeWorkspaceId])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback((connectionSlug?: string) => {
    setEditingConnectionSlug(connectionSlug || null)
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
    setEditingConnectionSlug(null)
    setImageConnectionSetup(false)
    setIsDirectEdit(false)
    setEditInitialValues(undefined)
  }, [setFullscreenOverlayOpen])

  // Derive existing slugs for unique slug generation
  const existingSlugs = useMemo(
    () => new Set(llmConnections.map(c => c.slug)),
    [llmConnections],
  )

  // OnboardingWizard hook for editing API connection
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'provider-select',
    onConfigSaved: refreshLlmConnections,
    onComplete: () => {
      closeApiSetup()
      refreshLlmConnections?.()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
    editingSlug: editingConnectionSlug,
    existingSlugs,
  })

  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    refreshLlmConnections?.()
    apiSetupOnboarding.reset()
    // Clear any credential health issues after successful re-authentication
    setCredentialHealthIssues([])
    setIsDirectEdit(false)
    setEditInitialValues(undefined)
  }, [closeApiSetup, refreshLlmConnections, apiSetupOnboarding])

  // Handler for closing the modal via X button or Escape - resets state and cancels OAuth
  const handleCloseApiSetup = useCallback(() => {
    closeApiSetup()
    apiSetupOnboarding.reset()
    setIsDirectEdit(false)
    setEditInitialValues(undefined)
  }, [closeApiSetup, apiSetupOnboarding])

  // Handler for re-authenticate button in credential health banner
  const handleReauthenticate = useCallback(() => {
    // Open API setup for the default connection (or first connection if available)
    const defaultConn = llmConnections.find(c => c.isDefault) || llmConnections[0]
    if (defaultConn) {
      openApiSetup(defaultConn.slug)
    } else {
      openApiSetup()
    }
  }, [llmConnections, openApiSetup])

  // Connection action handlers
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

  const handleReauthenticateConnection = useCallback((connection: LlmConnectionWithStatus) => {
    openApiSetup(connection.slug)
    apiSetupOnboarding.reset()

    if (connection.authType === 'oauth') {
      const piAuth = connection.piAuthProvider
      let method: ApiSetupMethod
      if (connection.providerType === 'pi') {
        if (piAuth === 'github-copilot') method = 'pi_copilot_oauth'
        else if (piAuth === 'chatgpt-plus') method = 'pi_chatgpt_oauth'
        else if (piAuth === 'grok-x') method = 'pi_xai_oauth'
        else if (piAuth === 'openrouter') method = 'pi_openrouter_oauth'
        else if (piAuth === 'kimi-coding') method = 'pi_kimi_oauth'
        else if (piAuth === 'radius') method = 'pi_radius_oauth'
        else method = 'pi_chatgpt_oauth'
      } else {
        method = 'claude_oauth'
      }
      apiSetupOnboarding.handleStartOAuth(method, connection.slug)
    }
  }, [apiSetupOnboarding, openApiSetup])

  const handleEditConnection = useCallback(async (connection: LlmConnectionWithStatus) => {
    // Fetch stored API key (best-effort — if IPC not available yet, skip pre-fill)
    let apiKey: string | undefined
    try {
      apiKey = (await window.electronAPI.getLlmConnectionApiKey(connection.slug)) ?? undefined
    } catch {
      // IPC method may not exist if app wasn't restarted after code change
    }

    // Build model string from connection's models array
    const modelStr = connection.models
      ?.map((m: string | ModelDefinition) => typeof m === 'string' ? m : m.id)
      .join(', ') || connection.defaultModel || ''

    // Set initial values before opening overlay so ApiKeyInput mounts with them
    const modelIds = connection.models
      ?.map((m: string | ModelDefinition) => typeof m === 'string' ? m : m.id)
      .filter(Boolean)

    const isCustomEndpointConnection = !!connection.customEndpoint && !!connection.baseUrl?.trim()

    setEditInitialValues({
      apiKey,
      baseUrl: connection.baseUrl,
      connectionDefaultModel: isCustomEndpointConnection ? modelStr : connection.defaultModel,
      utilityModel: connection.utilityModel,
      activePreset: isCustomEndpointConnection ? 'custom' : (connection.piAuthProvider || undefined),
      models: modelIds,
      customApi: connection.customEndpoint?.api,
    })

    // Open overlay and jump directly to credentials step (no reset — jumpToCredentials sets state)
    openApiSetup(connection.slug)
    setIsDirectEdit(true)
    const method = getApiKeyMethodForConnection(connection)
    apiSetupOnboarding.jumpToCredentials(method)
  }, [apiSetupOnboarding, openApiSetup])

  const handleDeleteConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.deleteLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to delete connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to delete connection:', error)
    }
  }, [refreshLlmConnections])

  const handleValidateConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return

    // Set validating state
    setValidationStates(prev => ({ ...prev, [slug]: { state: 'validating' } }))

    try {
      const result = await window.electronAPI.testLlmConnection(slug)

      if (result.success) {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'success' } }))
      } else {
        setValidationStates(prev => ({
          ...prev,
          [slug]: { state: 'error', error: result.error }
        }))

      }
    } catch (error) {
      setValidationStates(prev => ({
        ...prev,
        [slug]: { state: 'error', error: t("settings.ai.validationFailed") }
      }))

    }
  }, [t])

  const handleSetDefaultConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.setDefaultLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to set default connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to set default connection:', error)
    }
  }, [refreshLlmConnections])

  // Update a connection's mid-stream send behavior (steer vs queue).
  // Uses the same saveLlmConnection RPC as other connection edits.
  const handleSetMidStreamBehavior = useCallback(async (
    connection: LlmConnectionWithStatus,
    behavior: MidStreamBehavior,
  ) => {
    if (!window.electronAPI) return
    if (resolveMidStreamBehavior(connection) === behavior) return
    try {
      const updated = { ...connection, midStreamBehavior: behavior }
      const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = updated
      const result = await window.electronAPI.saveLlmConnection(connectionData as import('../../../shared/types').LlmConnection)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to update mid-stream behavior:', result.error)
        toast.error(t('settings.ai.midStream.updateFailed'))
      }
    } catch (error) {
      console.error('Failed to update mid-stream behavior:', error)
      toast.error(t('settings.ai.midStream.updateFailed'))
    }
  }, [refreshLlmConnections, t])

  // Get the default connection for display
  const defaultConnection = useMemo(() => {
    return llmConnections.find(c => c.isDefault)
  }, [llmConnections])

  // Anthropic account UUIDs that resolve from 2+ connections (issue #838).
  // Surfaces a warning when several Claude connections share one account/quota.
  const duplicateAccountUuids = useMemo(() => {
    const counts = new Map<string, number>()
    for (const conn of llmConnections) {
      const uuid = conn.oauthAccountUuid
      if (uuid) counts.set(uuid, (counts.get(uuid) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([uuid]) => uuid))
  }, [llmConnections])

  const defaultModel = defaultConnection?.defaultModel ?? ''

  // App-level default handlers
  const handleDefaultModelChange = useCallback(async (model: string) => {
    if (!window.electronAPI || !defaultConnection) return
    // Update defaultModel on the connection, then save the full connection
    const updated = { ...defaultConnection, defaultModel: model }
    // Remove status fields that aren't part of LlmConnection
    const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = updated
    await window.electronAPI.saveLlmConnection(connectionData as import('../../../shared/types').LlmConnection)
    await refreshLlmConnections()
  }, [defaultConnection, refreshLlmConnections])

  const handleDefaultThinkingChange = useCallback(async (level: ThinkingLevel) => {
    if (!window.electronAPI) return

    const previous = defaultThinking
    setDefaultThinking(level)

    try {
      const result = await window.electronAPI.setDefaultThinkingLevel(level)
      if (!result.success) {
        console.error('Failed to set default thinking level:', result.error)
        setDefaultThinking(previous)
      }
    } catch (error) {
      console.error('Failed to set default thinking level:', error)
      setDefaultThinking(previous)
    }
  }, [defaultThinking])

  const handleExtendedPromptCacheChange = useCallback(async (enabled: boolean) => {
    const previous = extendedPromptCache
    setSavingExtendedCache(true); setExtendedPromptCache(enabled)
    try { await window.electronAPI.setExtendedPromptCache(enabled) }
    catch { setExtendedPromptCache(previous); toast.error(t("toast.failedToSaveSetting", { setting: t("settings.ai.extendedPromptCache") })) }
    finally { setSavingExtendedCache(false) }
  }, [extendedPromptCache, t])

  const handlePromptCacheWarmingChange = useCallback(async (enabled: boolean) => {
    setSavingCacheWarming(true)
    try {
      await window.electronAPI.setPromptCacheWarming(enabled)
      setPromptCacheWarming(enabled)
    } catch {
      toast.error(t("toast.failedToSaveSetting", { setting: t("settings.ai.promptCacheWarming") }))
    } finally {
      setSavingCacheWarming(false)
    }
  }, [t])

  const handleContextPolicyChange = useCallback(async (next: ContextPolicy) => {
    const previous = contextPolicy
    if (next === previous) return
    setSavingContextPolicy(true)
    // Optimistic switch: the two strategies are mutually exclusive by
    // construction, so the UI must never show both as on.
    setContextPolicy(next)
    try {
      await window.electronAPI.setContextPolicy(next)
    } catch {
      setContextPolicy(previous)
      toast.error(t("toast.failedToSaveSetting", { setting: t("settings.ai.context.title") }))
    } finally {
      setSavingContextPolicy(false)
    }
  }, [contextPolicy, t])

  const handleRtkToggle = useCallback(async (enabled: boolean) => {
    const previous = rtkEnabled
    setSavingRtk(true); setRtkEnabled(enabled)
    try { await window.electronAPI.setRtkEnabled(enabled) }
    catch { setRtkEnabled(previous); toast.error(t("toast.failedToSaveSetting", { setting: t("settings.ai.rtk.title") })) }
    finally { setSavingRtk(false) }
  }, [rtkEnabled, t])

  const handleRecheckRtk = useCallback(async () => {
    setRtkRechecking(true)
    try {
      const status = await window.electronAPI?.getRtkStatus({ forceRecheck: true })
      if (status) setRtkStatus(status)
    } finally {
      setRtkRechecking(false)
    }
  }, [])

  const handleGetRtk = useCallback(() => {
    window.electronAPI?.openUrl('https://github.com/rtk-ai/rtk')
  }, [])

  const refreshRtkGain = useCallback(async () => {
    const gain = await window.electronAPI?.getRtkGain()
    setRtkGain(gain ?? null)
  }, [])

  // Refresh gain stats whenever rtk transitions to installed-and-enabled
  useEffect(() => {
    if (rtkStatus?.path && !rtkStatus.outdated && rtkEnabled) {
      refreshRtkGain()
    } else {
      setRtkGain(null)
    }
  }, [rtkStatus?.path, rtkStatus?.outdated, rtkEnabled, refreshRtkGain])

  const [imageRetry, setImageRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (typeof window.electronAPI.getImageGenerationSettings !== 'function') return
    window.electronAPI.getImageGenerationSettings().then(status => {
      if (!cancelled) { setImageStatus(status); setImageSettingsError(null) }
    }).catch(error => { if (!cancelled) setImageSettingsError(String(error)) })
    return () => { cancelled = true }
  }, [llmConnections, imageRetry])

  const saveImageSettings = useCallback(async (settings: ImageGenerationSettings) => {
    setSavingImages(true)
    try { setImageStatus(await window.electronAPI.setImageGenerationSettings(settings)); setImageSettingsError(null) }
    catch (error) { setImageSettingsError(error instanceof Error ? error.message : String(error)) }
    finally { setSavingImages(false) }
  }, [])

  useEffect(() => {
    const focus = () => {
      if (sessionStorage.getItem(AI_SETTINGS_FOCUS_KEY) !== 'decisions') return
      setDecisionConfigurationOpen(true)
      if (decisionStatus || decisionLoadError) {
        sessionStorage.removeItem(AI_SETTINGS_FOCUS_KEY)
        requestAnimationFrame(() => document.querySelector('[data-decision-settings]')?.scrollIntoView({ block: 'start' }))
      }
    }
    focus(); window.addEventListener(AI_SETTINGS_FOCUS_EVENT, focus)
    return () => window.removeEventListener(AI_SETTINGS_FOCUS_EVENT, focus)
  }, [decisionStatus, decisionLoadError])

  // ---- Decision model (Jev) ----
  const decisionUsageNote = (feature: DecisionLayerFeature) => {
    if (!decisionUsage) return undefined
    const usage = decisionUsage.features[feature]
    if (!usage) return t(decisionStatus?.settings.enabled && decisionStatus.settings.features[feature] ? 'settings.ai.decisions.usageNone' : 'settings.ai.decisions.usageDisabled')
    return <div className="space-y-1" data-decision-usage={feature}>
      <p>{t('settings.ai.decisions.usageSummary', { calls: usage.calls, failures: usage.failures, changed: usage.changed, outcomes: usage.withOutcome })}</p>
      <p>{t('settings.ai.decisions.usageDetails', { cancelled: usage.cancelled, coldFailed: usage.coldFailures, coldCalls: usage.coldCalls,
        cost: usage.knownCostUsd.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 6 }), unknown: usage.unknownCostCalls })}</p>
      {usage.withOutcome >= 30 && usage.changed === 0 && <p>{t('settings.ai.decisions.usageNoChange')}</p>}
    </div>
  }
  const refreshDecisionStatus = useCallback(async (seedDrafts: boolean) => {
    if (typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    try {
      const status = await window.electronAPI.getDecisionLayerStatus()
      setDecisionStatus(status)
      setDecisionLoadError(null)
      setGuardedAvailable(status.guardedMode?.available === true)
      if (seedDrafts) {
        setDecisionModelDraft(status.settings.model ?? '')
        setDecisionBaseUrlDraft(status.settings.baseUrl ?? '')
        decisionDraftsSeededRef.current = true
      }
    } catch (error) {
      setGuardedAvailable(false)
      setDecisionLoadError(error instanceof Error ? error.message : String(error))
      setDecisionStatus(previous => previous ? { ...previous, guardedMode: { available: false, reason: 'unavailable' } } : previous)
      console.error('Failed to load decision model settings:', error)
    }
  }, [setGuardedAvailable])

  // Reusable connections come from the LLM connection list, so refresh with it
  // (background model fetches re-emit that list; only the first load seeds drafts).
  useEffect(() => {
    void refreshDecisionStatus(!decisionDraftsSeededRef.current)
  }, [refreshDecisionStatus, llmConnections])

  const updateDecisionSettings = useCallback(async (patch: DecisionLayerSettingsPatch) => {
    setSavingDecisions(true)
    try {
      const next = await window.electronAPI.setDecisionLayerSettings(patch)
      setDecisionStatus(prev => (prev ? { ...prev, settings: next } : prev))
      setDecisionTestResult(null)
      await refreshDecisionStatus(false)
      // Mode pickers offer Guarded mode only while it is on: let them refresh.
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
      // A provider/connection switch drops the model + base URL overrides server-side
      // (they belonged to the previous provider) — mirror that in the inputs.
      if ('provider' in patch || 'connectionSlug' in patch) {
        setDecisionModelDraft(next.model ?? '')
        setDecisionBaseUrlDraft(next.baseUrl ?? '')
      }
    } catch (error) {
      console.error('Failed to update decision model settings:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    } finally { setSavingDecisions(false) }
  }, [t, refreshDecisionStatus])

  const decisionPreset = useMemo(
    () => decisionStatus?.presets.find(p => p.id === decisionStatus.settings.provider),
    [decisionStatus],
  )
  // Decision-model features for Advanced settings, grouped by what they touch.
  // Literal t() keys keep the i18n coverage check effective.
  const decisionFeatureGroups: Array<{ id: string; title: string; toggles: Array<{ feature: DecisionLayerFeature; label: string; description: string; tooltip: string }> }> = [
    { id: 'agent', title: t("settings.ai.decisions.groupAgent"), toggles: [
      { feature: 'decideTool', label: t("settings.ai.decisions.featureDecideTool"), description: t("settings.ai.decisions.featureDecideToolDesc"), tooltip: t("settings.ai.decisions.featureDecideToolTooltip") },
      { feature: 'suggestions', label: t("settings.ai.decisions.featureSuggestions"), description: t("settings.ai.decisions.featureSuggestionsDesc"), tooltip: t("settings.ai.decisions.featureSuggestionsTooltip") },
      { feature: 'adaptiveThinking', label: t("settings.ai.decisions.featureAdaptiveThinking"), description: t("settings.ai.decisions.featureAdaptiveThinkingDesc"), tooltip: t("settings.ai.decisions.featureAdaptiveThinkingTooltip") },
      { feature: 'largeResults', label: t("settings.ai.decisions.featureLargeResults"), description: t("settings.ai.decisions.featureLargeResultsDesc"), tooltip: t("settings.ai.decisions.featureLargeResultsTooltip") },
    ] },
    { id: 'conversation', title: t("settings.ai.decisions.groupConversation"), toggles: [
      { feature: 'midTurnMessages', label: t("settings.ai.decisions.featureMidTurnMessages"), description: t("settings.ai.decisions.featureMidTurnMessagesDesc"), tooltip: t("settings.ai.decisions.featureMidTurnMessagesTooltip") },
      { feature: 'turnOutcome', label: t("settings.ai.decisions.featureTurnOutcome"), description: t("settings.ai.decisions.featureTurnOutcomeDesc"), tooltip: t("settings.ai.decisions.featureTurnOutcomeTooltip") },
      { feature: 'smartTitles', label: t("settings.ai.decisions.featureSmartTitles"), description: t("settings.ai.decisions.featureSmartTitlesDesc"), tooltip: t("settings.ai.decisions.featureSmartTitlesTooltip") },
    ] },
    { id: 'permissions', title: t("settings.ai.decisions.groupPermissions"), toggles: [
      { feature: 'guardedMode', label: t("settings.ai.decisions.featureGuardedMode"), description: t("settings.ai.decisions.featureGuardedModeDesc"), tooltip: t("settings.ai.decisions.featureGuardedModeTooltip") },
      { feature: 'riskBadges', label: t("settings.ai.decisions.featureRiskBadges"), description: t("settings.ai.decisions.featureRiskBadgesDesc"), tooltip: t("settings.ai.decisions.featureRiskBadgesTooltip") },
    ] },
    { id: 'automations', title: t("settings.ai.decisions.groupAutomations"), toggles: [
      { feature: 'semanticLabels', label: t("settings.ai.decisions.featureSemanticLabels"), description: t("settings.ai.decisions.featureSemanticLabelsDesc"), tooltip: t("settings.ai.decisions.featureSemanticLabelsTooltip") },
      { feature: 'automationConditions', label: t("settings.ai.decisions.featureAutomationConditions"), description: t("settings.ai.decisions.featureAutomationConditionsDesc"), tooltip: t("settings.ai.decisions.featureAutomationConditionsTooltip") },
      { feature: 'taskVerdicts', label: t("settings.ai.decisions.featureTaskVerdicts"), description: t("settings.ai.decisions.featureTaskVerdictsDesc"), tooltip: t("settings.ai.decisions.featureTaskVerdictsTooltip") },
      { feature: 'taskRepairs', label: t("settings.ai.decisions.featureTaskRepairs"), description: t("settings.ai.decisions.featureTaskRepairsDesc"), tooltip: t("settings.ai.decisions.featureTaskRepairsTooltip") },
    ] },
  ]
  // A remote server on an older version reports fewer features: show and count only what it knows.
  const decisionReportedGroups = decisionStatus
    ? decisionFeatureGroups
      .map(group => ({ ...group, toggles: group.toggles.filter(({ feature }) => feature in decisionStatus.settings.features) }))
      .filter(group => group.toggles.length > 0)
    : []
  const decisionKeySourceValue = decisionStatus?.settings.connectionSlug
    ? `connection:${decisionStatus.settings.connectionSlug}`
    : `provider:${decisionStatus?.settings.provider ?? 'typesafe'}`
  const decisionKeySourceOptions = useMemo(() => {
    if (!decisionStatus) return []
    return [
      ...decisionStatus.presets.map(p => ({
        value: `provider:${p.id}`,
        label: p.label,
        description: p.local
          ? (p.id === 'custom' ? t("settings.ai.decisions.customProviderDesc") : t("settings.ai.decisions.localProviderDesc"))
          : p.baseUrl,
      })),
      ...decisionStatus.reusableConnections.map(c => ({
        value: `connection:${c.slug}`,
        label: t("settings.ai.decisions.reuseConnection", { name: c.name }),
        description: decisionStatus.presets.find(p => p.id === c.provider)?.label ?? c.provider,
      })),
    ]
  }, [decisionStatus, t])
  const decisionHasStoredKey = !!decisionStatus && decisionStatus.providersWithKey.includes(decisionStatus.settings.provider)
  const decisionKeyHelpUrl = decisionPreset?.dashboardUrl ?? decisionPreset?.docsUrl
  const decisionUsesConnection = !!decisionStatus?.settings.connectionSlug
  // Local presets (Laya, custom) expose the base URL and a server probe instead of a key hint.
  const decisionUsesLocalProvider = !!decisionPreset?.local && !decisionUsesConnection
  const decisionUsesCustomProvider = decisionStatus?.settings.provider === 'custom' && !decisionUsesConnection

  const probeDecisionServer = useCallback(async (baseUrl?: string) => {
    if (typeof window.electronAPI?.probeDecisionServer !== 'function') return
    setDecisionProbing(true)
    try {
      setDecisionProbe(await window.electronAPI.probeDecisionServer(baseUrl ? { baseUrl } : undefined))
    } catch (error) {
      console.error('Failed to probe decision server:', error)
      setDecisionProbe(null)
    } finally {
      setDecisionProbing(false)
    }
  }, [])

  // Probe whenever a local provider is selected or its base URL changes on disk.
  useEffect(() => {
    if (!decisionUsesLocalProvider) { setDecisionProbe(null); return }
    void probeDecisionServer()
  }, [decisionUsesLocalProvider, decisionStatus?.settings.provider, decisionStatus?.settings.baseUrl, probeDecisionServer])

  const decisionProbeDescription = decisionProbing || (decisionUsesLocalProvider && !decisionProbe)
    ? t("common.checking")
    : decisionProbe?.reachable && decisionProbe.health
      ? t("settings.ai.decisions.localServerRunning", { url: decisionProbe.baseUrl, models: decisionProbe.health.loaded?.length ? decisionProbe.health.loaded.join(', ') : '—' })
      : decisionProbe?.reachable
        ? t("settings.ai.decisions.localServerReachable", { url: decisionProbe.baseUrl })
        : t("settings.ai.decisions.localServerUnreachable", { url: decisionProbe?.baseUrl ?? '' })

  const handleDecisionKeySourceChange = useCallback((value: string) => {
    setDecisionKeyDraft('')
    if (value.startsWith('connection:')) {
      const slug = value.slice('connection:'.length)
      const provider = decisionStatus?.reusableConnections.find(c => c.slug === slug)?.provider
      void updateDecisionSettings({ connectionSlug: slug, ...(provider ? { provider } : {}) })
    } else if (value.startsWith('provider:')) {
      void updateDecisionSettings({ connectionSlug: null, provider: value.slice('provider:'.length) as DecisionProviderId })
    }
  }, [decisionStatus, updateDecisionSettings])

  const commitDecisionField = useCallback((field: 'model' | 'baseUrl', value: string) => {
    const current = decisionStatus?.settings[field] ?? ''
    if (value.trim() === current) return
    void updateDecisionSettings({ [field]: value.trim() || null })
  }, [decisionStatus, updateDecisionSettings])

  const handleSaveDecisionKey = useCallback(async () => {
    if (!decisionStatus || !decisionKeyDraft.trim()) return
    try {
      await window.electronAPI.setDecisionApiKey(decisionStatus.settings.provider, decisionKeyDraft.trim())
      setDecisionKeyDraft('')
      toast.success(t("settings.ai.decisions.keySaved"))
      await refreshDecisionStatus(false)
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
    } catch (error) {
      console.error('Failed to save decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, decisionKeyDraft, refreshDecisionStatus, t])

  const handleRemoveDecisionKey = useCallback(async () => {
    if (!decisionStatus) return
    try {
      await window.electronAPI.deleteDecisionApiKey(decisionStatus.settings.provider)
      toast.success(t("settings.ai.decisions.keyRemoved"))
      await refreshDecisionStatus(false)
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
    } catch (error) {
      console.error('Failed to remove decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, refreshDecisionStatus, t])

  const handleTestDecision = useCallback(async () => {
    setDecisionTesting(true)
    setDecisionTestResult(null)
    try {
      const result = await window.electronAPI.testDecisionConnection({
        settings: { model: decisionModelDraft.trim() || null, baseUrl: decisionBaseUrlDraft.trim() || null },
        apiKey: decisionKeyDraft.trim() || undefined,
      })
      setDecisionTestResult(result)
    } catch (error) {
      setDecisionTestResult({ ok: false, failure: { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      setDecisionTesting(false)
    }
  }, [decisionModelDraft, decisionBaseUrlDraft, decisionKeyDraft])

  const decisionTestDescription = decisionTestResult
    ? decisionTestResult.ok
      ? t("settings.ai.decisions.testSuccess", { model: decisionTestResult.model, latency: decisionTestResult.latencyMs })
      : t("settings.ai.decisions.testFailed", { message: decisionTestResult.failure.message })
    : t("settings.ai.decisions.testDesc")

  const openImageConnectionSetup = () => {
    setImageConnectionSetup(true)
    setEditInitialValues({ activePreset: 'openai' })
    openApiSetup()
    apiSetupOnboarding.jumpToCredentials('pi_api_key')
  }
  const imageSelected = imageStatus?.connections.find(c => c.slug === imageStatus.settings.connectionSlug)
  const imageSelectedName = imageSelected?.name || llmConnections.find(c => c.slug === imageStatus?.settings.connectionSlug)?.name || imageStatus?.settings.connectionSlug
  const imageEffective = imageStatus?.effective
  const imageUnconfigured = !!imageStatus && !imageStatus.settings.connectionSlug && !imageStatus.settings.model && !imageStatus.connections.length
  const imageStatusError = imageUnconfigured ? undefined : imageStatus?.error
  const imageModelConnection = imageSelected || (!imageStatus?.settings.connectionSlug ? imageStatus?.connections.find(c => c.slug === imageEffective?.connectionSlug)
    || imageStatus?.connections.find(c => c.available && c.slug === defaultConnection?.slug) || imageStatus?.connections.find(c => c.available) : undefined)
  const imageSummary = imageSettingsError ? t("settings.ai.statusUnavailable") : !imageStatus ? t("common.loading")
    : imageEffective ? `${imageStatus.settings.connectionSlug ? '' : `${t("settings.ai.images.automatic")}: `}${imageEffective.connectionName} · ${imageEffective.model}`
    : imageStatus.settings.connectionSlug ? t("settings.ai.images.accountUnavailable", { name: imageSelectedName }) : imageStatusError ? t("settings.ai.images.needsAttention") : t("settings.ai.images.notConfigured")
  const decisionSummary = decisionLoadError ? t("settings.ai.statusUnavailable") : !decisionStatus ? t("common.loading")
    : !decisionStatus.settings.enabled ? `${t("settings.ai.decisions.advancedSummaryOff")}${decisionStatus.settings.features.guardedMode ? ` · ${t("settings.ai.guarded.notReadySummary")}` : ''}`
    : decisionStatus.settings.features.guardedMode && !decisionStatus.guardedMode?.available ? t("settings.ai.guarded.notReadySummary")
    : t("settings.ai.decisionConfigured", { provider: decisionPreset?.label, model: decisionStatus.settings.model || decisionPreset?.defaultModel })
  const performanceSummary = [extendedPromptCache && t("settings.ai.extendedPromptCache"), promptCacheWarming && t("settings.ai.promptCacheWarming"), rtkEnabled && rtkStatus?.installed && !rtkStatus.outdated && 'RTK'].filter(Boolean).join(' · ') || t("settings.ai.usingDefaults")

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.ai.title")} actions={<HeaderMenu route={routes.view.settings('ai')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            {/* Credential Health Warning Banner */}
            <CredentialHealthBanner
              issues={credentialHealthIssues}
              onReauthenticate={handleReauthenticate}
            />

            <div className="space-y-8">
              {/* Connections Management */}
              <div data-ai-settings-section="connections"><SettingsSection title={t("settings.ai.connections")} description={t("settings.ai.connectionsDesc")}>
                <SettingsCard>
                  {llmConnections.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t("settings.ai.noConnections")}
                    </div>
                  ) : (
                    [...llmConnections]
                      .sort((a, b) => {
                        if (a.isDefault && !b.isDefault) return -1
                        if (!a.isDefault && b.isDefault) return 1
                        return a.name.localeCompare(b.name)
                      })
                      .map((conn) => (
                      <ConnectionRow
                        key={conn.slug}
                        connection={conn}
                        usedForImages={imageStatus?.effective?.connectionSlug === conn.slug}
                        isLastConnection={false}
                        onRenameClick={() => handleRenameClick(conn)}
                        onDelete={() => handleDeleteConnection(conn.slug)}
                        onSetDefault={() => handleSetDefaultConnection(conn.slug)}
                        onValidate={() => handleValidateConnection(conn.slug)}
                        onReauthenticate={() => handleReauthenticateConnection(conn)}
                        onEdit={() => handleEditConnection(conn)}
                        onSetMidStreamBehavior={(behavior) => handleSetMidStreamBehavior(conn, behavior)}
                        validationState={validationStates[conn.slug]?.state || 'idle'}
                        validationError={validationStates[conn.slug]?.error}
                        isDuplicateAccount={!!conn.oauthAccountUuid && duplicateAccountUuids.has(conn.oauthAccountUuid)}
                      />
                    ))
                  )}
                </SettingsCard>
                <div className="pt-0">
                  <button
                    onClick={() => openApiSetup()}
                    className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                  >
                    {t("settings.ai.addConnection")}
                  </button>
                </div>
              </SettingsSection></div>

              <div data-ai-settings-section="conversation">
              <SettingsSection title={t("settings.ai.defaultSection")} description={t("settings.ai.defaultSectionDesc")}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    id="default-connection-select"
                    label={t("settings.ai.connection")}
                    description={t("settings.ai.connectionDesc")}
                    value={defaultConnection?.slug || ''}
                    disabled={!llmConnections.length}
                    onValueChange={handleSetDefaultConnection}
                    options={llmConnections.map((conn) => ({
                      value: conn.slug,
                      label: conn.name,
                      description: conn.authType === 'oauth' ? t("settings.ai.authSubscription") : t("settings.ai.authApiKey"),
                    }))}
                  />
                  <SettingsMenuSelectRow
                    label={t("settings.ai.model")}
                    description={t("settings.ai.modelDesc")}
                    value={defaultModel}
                    disabled={!defaultConnection}
                    onValueChange={handleDefaultModelChange}
                    options={getModelOptionsForConnection(defaultConnection).map(o => ({
                      ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description,
                    }))}
                  />
                  <SettingsMenuSelectRow
                    label={t("settings.ai.thinking")}
                    description={t("settings.ai.thinkingDesc")}
                    value={defaultThinking}
                    onValueChange={(v) => handleDefaultThinkingChange(v as ThinkingLevel)}
                    options={THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({
                      value: id,
                      label: t(nameKey),
                      description: t(descriptionKey),
                    }))}
                  />
                  <SettingsMenuSelectRow
                    id="context-policy-select"
                    label={t("settings.ai.context.title")}
                    description={contextPolicyOptions.find(option => option.value === contextPolicy)?.description}
                    value={contextPolicy}
                    options={contextPolicyOptions}
                    disabled={savingContextPolicy}
                    onValueChange={value => void handleContextPolicyChange(value as ContextPolicy)}
                  />

                </SettingsCard>
                {activeWorkspace && <div data-workspace-conversation-link><SettingsCard>
                  <SettingsRow label={t("settings.ai.workspaceModels")} onClick={() => navigate(routes.view.settings('workspace'))}
                    description={workspaceLoadError ? t("settings.ai.workspaceLoadFailed") : !workspaceSettings ? t("common.loading") : workspaceSettings.defaultLlmConnection || workspaceSettings.model || workspaceSettings.thinkingLevel ? t("settings.ai.workspaceOverrideStatus", { name: activeWorkspace.name }) : t("settings.ai.workspaceInherited")}>
                    <Button variant="ghost" size="sm" onClick={() => navigate(routes.view.settings('workspace'))} aria-label={t("settings.ai.workspaceModels")}><ChevronRight className="size-4" /></Button>
                  </SettingsRow>
                </SettingsCard></div>}
              </SettingsSection></div>
              <div data-ai-settings-section="advanced"><SettingsSection title={t("settings.ai.advanced")}>
                <div className="space-y-3">
                  <div data-ai-advanced="images" data-image-generation-settings>
                    <SettingsDisclosure title={t("settings.ai.images.title")} summary={imageSummary} open={imageConfigurationOpen} onOpenChange={setImageConfigurationOpen}>
                      <p className="px-4 pt-4 pb-1 text-xs text-muted-foreground">{t("settings.ai.images.description")}</p>
                      {imageStatus && (imageStatus.connections.length > 0 || imageStatus.settings.connectionSlug) ? <>
                        <SettingsMenuSelectRow label={t("settings.ai.connection")} value={imageStatus.settings.connectionSlug || 'automatic'} disabled={savingImages}
                          onValueChange={slug => void saveImageSettings(slug === 'automatic' ? {} : { connectionSlug: slug })}
                          options={[{ value: 'automatic', label: t("settings.ai.images.automatic"), description: imageEffective ? `${imageEffective.connectionName} · ${imageEffective.model}` : t("settings.ai.images.automaticDesc") },
                            ...(imageStatus.settings.connectionSlug && !imageSelected ? [{ value: imageStatus.settings.connectionSlug, label: imageSelectedName || imageStatus.settings.connectionSlug, description: t("settings.ai.notAuthenticated") }] : []),
                            ...imageStatus.connections.map(c => ({ value: c.slug, label: c.name, description: c.available ? c.provider : t("settings.ai.notAuthenticated") }))]} />
                        {imageModelConnection && <SettingsMenuSelectRow label={t("settings.ai.model")} value={imageStatus.settings.model || 'provider-default'} disabled={savingImages}
                          onValueChange={model => void saveImageSettings({ ...imageStatus.settings, ...(model === 'provider-default' ? { model: undefined } : { model }) })}
                          options={[{ value: 'provider-default', label: t("settings.ai.useConnectionDefault"), description: imageEffective?.model },
                            ...(imageStatus.settings.model && !imageModelConnection.models.some(m => m.id === imageStatus.settings.model) ? [{ value: imageStatus.settings.model, label: imageStatus.settings.model, description: t("settings.ai.unavailableModel") }] : []),
                            ...imageModelConnection.models.map(model => ({ value: model.id, label: model.name }))]} />}
                        {imageStatus.settings.connectionSlug && <p className="px-4 pb-4 text-xs text-muted-foreground">{t("settings.ai.images.selectionNote")}</p>}
                      </> : !imageStatus && !imageSettingsError ? <SettingsRow label={t("settings.ai.images.effective")} description={t("common.loading")} /> : null}
                      {imageStatus && !imageStatus.connections.length && !imageStatus.settings.connectionSlug && <SettingsRow label={t("settings.ai.images.notConfigured")} description={t("settings.ai.images.setupGuidance")}>
                        <Button variant="outline" size="sm" onClick={openImageConnectionSetup}>{t("settings.ai.images.addConnection")}</Button>
                      </SettingsRow>}
                      {(imageSettingsError || imageStatusError) && <div role="alert" className="px-4 pb-4 space-y-3 text-sm text-destructive">
                        <p>{imageSettingsError || imageStatusError}</p>
                        <div className="flex flex-wrap gap-2">
                          {imageSettingsError && <Button variant="outline" size="sm" onClick={() => setImageRetry(n => n + 1)}>{t("common.retry")}</Button>}
                          {imageStatus?.settings.connectionSlug && !imageEffective && <>
                            {llmConnections.find(c => c.slug === imageStatus.settings.connectionSlug) && <Button variant="outline" size="sm" onClick={() => handleEditConnection(llmConnections.find(c => c.slug === imageStatus.settings.connectionSlug)!)}>{t("settings.ai.images.updateKey")}</Button>}
                            <Button variant="outline" size="sm" onClick={openImageConnectionSetup}>{t("settings.ai.images.addConnection")}</Button>
                          </>}
                        </div>
                      </div>}
                    </SettingsDisclosure>
                  </div>
                  <div data-ai-advanced="decisions" data-decision-settings>
                    <SettingsDisclosure title={t("settings.ai.decisions.title")} summary={decisionSummary} open={decisionConfigurationOpen} onOpenChange={setDecisionConfigurationOpen}>
                      {decisionLoadError ? <div role="alert" className="craft-settings-padding flex flex-wrap items-center justify-between gap-3 text-sm text-destructive">
                        <span>{decisionLoadError}</span><Button variant="outline" size="sm" onClick={() => void refreshDecisionStatus(!decisionDraftsSeededRef.current)}>{t("common.retry")}</Button>
                      </div> : decisionStatus ? <>
                    <SettingsToggle
                      label={t("settings.ai.decisions.enable")}
                      description={t("settings.ai.decisions.enableDesc")}
                      checked={decisionStatus.settings.enabled}
                      disabled={savingDecisions}
                      onCheckedChange={(enabled) => { void updateDecisionSettings({ enabled }) }}
                    />
                    <SettingsMenuSelectRow
                      label={t("settings.ai.decisions.keySource")}
                      description={t("settings.ai.decisions.keySourceDesc")}
                      value={decisionKeySourceValue}
                      disabled={savingDecisions}
                      onValueChange={handleDecisionKeySourceChange}
                      options={decisionKeySourceOptions}
                      menuWidth={340}
                    />
                    {decisionUsesLocalProvider && (
                      <SettingsInput
                        inCard
                        type="url"
                        label={t("settings.ai.decisions.baseUrl")}
                        description={decisionUsesCustomProvider ? t("settings.ai.decisions.baseUrlDesc") : t("settings.ai.decisions.baseUrlLocalDesc")}
                        value={decisionBaseUrlDraft}
                        disabled={savingDecisions}
                        onChange={setDecisionBaseUrlDraft}
                        onBlur={() => commitDecisionField('baseUrl', decisionBaseUrlDraft)}
                        placeholder={decisionPreset?.baseUrl || 'http://localhost:8080'}
                      />
                    )}
                    {decisionUsesLocalProvider && (
                      <SettingsRow
                        label={t("settings.ai.decisions.localServer")}
                        description={decisionProbeDescription}
                      >
                        {decisionPreset?.docsUrl && (
                          <Button
                            size="sm"
                            onClick={() => window.electronAPI?.openUrl(decisionPreset.docsUrl!)}
                            className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t("settings.ai.decisions.localServerDocs")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => { void probeDecisionServer(decisionBaseUrlDraft.trim() || undefined) }}
                          disabled={decisionProbing}
                          className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                        >
                          {decisionProbing ? t("common.checking") : t("settings.ai.decisions.recheck")}
                        </Button>
                      </SettingsRow>
                    )}
                    {decisionUsesLocalProvider && decisionPreset?.installHint && decisionProbe && !decisionProbe.reachable && (
                      <p className="px-4 pb-3 -mt-1 text-xs text-foreground/60">
                        {t("settings.ai.decisions.localServerInstallHint")}{' '}
                        <code className="font-mono text-[11px] text-foreground/80 select-all">{decisionPreset.installHint}</code>
                      </p>
                    )}
                    {!decisionUsesConnection && decisionPreset?.requiresKey !== false && (
                      decisionHasStoredKey ? (
                        <SettingsRow
                          label={t("settings.ai.decisions.apiKey")}
                          description={t("settings.ai.decisions.apiKeySaved")}
                        >
                          <Button
                            size="sm"
                            onClick={handleRemoveDecisionKey}
                            className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t("settings.ai.decisions.removeKey")}
                          </Button>
                        </SettingsRow>
                      ) : (
                        <SettingsInput
                          inCard
                          type="password"
                          label={t("settings.ai.decisions.apiKey")}
                          description={decisionKeyHelpUrl
                            ? t("settings.ai.decisions.apiKeyDesc", { url: decisionKeyHelpUrl })
                            : t("settings.ai.decisions.apiKeyDescGeneric")}
                          value={decisionKeyDraft}
                          onChange={setDecisionKeyDraft}
                          placeholder={decisionPreset?.keyPlaceholder}
                          action={(
                            <Button
                              size="sm"
                              onClick={handleSaveDecisionKey}
                              disabled={!decisionKeyDraft.trim()}
                              className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                            >
                              {t("settings.ai.decisions.saveKey")}
                            </Button>
                          )}
                        />
                      )
                    )}
                    <SettingsInput
                      inCard
                      label={t("settings.ai.decisions.model")}
                      description={t("settings.ai.decisions.modelDesc")}
                      value={decisionModelDraft}
                      disabled={savingDecisions}
                      onChange={setDecisionModelDraft}
                      onBlur={() => commitDecisionField('model', decisionModelDraft)}
                      placeholder={decisionPreset?.defaultModel}
                    />
                    <SettingsRow
                      label={t("settings.ai.decisions.test")}
                      description={decisionTestDescription}
                    >
                      <Button
                        size="sm"
                        onClick={handleTestDecision}
                        disabled={decisionTesting}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {decisionTesting ? t("common.checking") : t("settings.ai.decisions.testRun")}
                      </Button>
                    </SettingsRow>
                    <p className="px-4 pb-4 -mt-1 text-xs text-foreground/60">
                      {t("settings.ai.decisions.privacyNote")}
                    </p>
                      <div className="border-t border-border/50">
                            <div className="px-4 pt-3 text-xs text-muted-foreground" aria-live="polite">
                              {decisionUsageError ? <div className="flex flex-wrap items-center justify-between gap-2" role="status">
                                <span>{t('settings.ai.decisions.usageFailed')}</span><Button variant="ghost" size="sm" onClick={() => setDecisionUsageRetry(n => n + 1)}>{t('common.retry')}</Button>
                              </div> : decisionUsage ? t(decisionUsage.retentionLimited ? 'settings.ai.decisions.usageWindowLimited' : 'settings.ai.decisions.usageWindow') : t('common.loading')}
                            </div>
                            {decisionReportedGroups.map((group, index) => (
                              <div key={group.id} className={cn(index > 0 && 'mt-1 border-t border-border/30')}>
                                <div className="px-4 pt-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {group.title}
                                </div>
                                {group.toggles.map(({ feature, label, description, tooltip }) => (
                                  <SettingsToggle
                                    key={feature}
                                    label={label}
                                    description={description}
                                    tooltip={tooltip}
                                    note={decisionUsageNote(feature)}
                                    checked={decisionStatus.settings.features[feature] ?? false}
                                    disabled={savingDecisions}
                                    onCheckedChange={(checked) => { void updateDecisionSettings({ features: { [feature]: checked } }) }}
                                  />
                                ))}
                              </div>
                            ))}
                      </div>
                      </> : <SettingsRow label={t("settings.ai.decisions.title")} description={t("common.loading")} />}
                    </SettingsDisclosure>
                  </div>
                  <div data-ai-advanced="performance">
                    <SettingsDisclosure title={t("settings.ai.performance")} summary={performanceSummary} open={performanceOpen} onOpenChange={setPerformanceOpen}>
                  <p className="px-4 pt-4 text-xs text-muted-foreground">{t("settings.ai.cacheScope")}</p>
                  <SettingsToggle
                    label={t("settings.ai.extendedPromptCache")}
                    description={t("settings.ai.extendedPromptCacheDesc")}
                    checked={extendedPromptCache}
                    disabled={savingExtendedCache}
                    onCheckedChange={handleExtendedPromptCacheChange}
                  />
                  <SettingsToggle
                    label={t("settings.ai.promptCacheWarming")}
                    description={t("settings.ai.promptCacheWarmingDesc")}
                    checked={promptCacheWarming}
                    disabled={savingCacheWarming}
                    onCheckedChange={handlePromptCacheWarmingChange}
                  />
                  {rtkStatus?.installed ? (
                    <>
                      <SettingsToggle
                        label={t("settings.ai.rtk.title")}
                        description={t("settings.ai.rtk.description")}
                        checked={rtkEnabled && !rtkStatus.outdated}
                        disabled={rtkStatus.outdated || savingRtk}
                        onCheckedChange={handleRtkToggle}
                      />
                      {rtkStatus.outdated && (
                        <SettingsRow
                          label={t('settings.ai.rtk.outdated')}
                          description={t('settings.ai.rtk.outdatedDesc', { version: rtkStatus.version ?? '?', min: rtkStatus.minSafeVersion })}
                        >
                          <Button variant="outline" size="sm" onClick={() => setRtkUpdateOpen(true)}>
                            {t('settings.ai.rtk.update')}
                          </Button>
                        </SettingsRow>
                      )}
                      <RtkUpdateDialog open={rtkUpdateOpen} onOpenChange={setRtkUpdateOpen} status={rtkStatus} onStatusChange={setRtkStatus} />
                      {!rtkStatus.outdated && rtkEnabled && rtkGain && rtkGain.totalCommands > 0 && (
                        <div className="px-4 pb-4 -mt-1">
                          <div className="flex items-center justify-between text-xs text-foreground/60">
                            <span>
                              {t("settings.ai.rtk.gainSummary", {
                                saved: formatTokenCount(rtkGain.totalSaved),
                                count: rtkGain.totalCommands,
                                pct: rtkGain.avgSavingsPct.toFixed(1),
                              })}
                            </span>
                            <button
                              type="button"
                              onClick={refreshRtkGain}
                              className="text-foreground/60 hover:text-foreground transition-colors"
                              aria-label={t("settings.ai.rtk.gainRefresh")}
                            >
                              <RefreshCcw className="size-3" />
                            </button>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                            <div
                              className="motion-content h-full bg-foreground/60 transition-[width]"
                              style={{ width: `${Math.min(100, Math.max(0, rtkGain.avgSavingsPct))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <SettingsRow
                      label={t("settings.ai.rtk.title")}
                      description={rtkStatus === null ? t("common.checking") : t("settings.ai.rtk.notInstalledDesc")}
                    >
                      <Button
                        size="sm"
                        onClick={handleGetRtk}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {t("settings.ai.rtk.getRtk")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleRecheckRtk}
                        disabled={rtkRechecking || rtkStatus === null}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {rtkRechecking ? t("common.checking") : t("settings.ai.rtk.recheck")}
                      </Button>
                    </SettingsRow>
                  )}
                    </SettingsDisclosure>
                  </div>
                </div>
              </SettingsSection></div>

              {/* API Setup Fullscreen Overlay */}
              <FullscreenOverlayBase
                isOpen={showApiSetup}
                onClose={handleCloseApiSetup}
                className="z-splash flex flex-col bg-foreground-2"
              >
                <OnboardingWizard
                  state={apiSetupOnboarding.state}
                  onContinue={apiSetupOnboarding.handleContinue}
                  onBack={isDirectEdit || imageConnectionSetup ? handleCloseApiSetup : apiSetupOnboarding.handleBack}
                  onSelectProvider={apiSetupOnboarding.handleSelectProvider}
                  onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                  onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                  onSubmitLocalModel={apiSetupOnboarding.handleSubmitLocalModel}
                  onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                  onFinish={handleApiSetupFinish}
                  isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                  onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                  onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                  copilotDeviceCode={apiSetupOnboarding.copilotDeviceCode}
                  editInitialValues={editInitialValues}
                  allowedApiKeyPresets={imageConnectionSetup ? ['openai', 'openrouter'] : undefined}
                  className="h-full"
                />
                <div
                  className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                  style={{ zIndex: 'var(--z-fullscreen, 350)' }}
                >
                  <button
                    data-onboarding-close
                    onClick={handleCloseApiSetup}
                    className="motion-interactive p-1.5 rounded-[6px] transition-[color,background-color,box-shadow,opacity,transform] bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={t("common.closeEsc")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </FullscreenOverlayBase>

              {/* Rename Connection Dialog */}
              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title={t("settings.ai.renameConnection")}
                value={renameValue}
                onValueChange={setRenameValue}
                onSubmit={handleRenameSubmit}
                placeholder={t("settings.ai.enterConnectionName")}
              />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
