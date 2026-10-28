/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and endpoint-specific configuration. Models are discovered by the server.
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react"

import {
  resolveCustomEndpointPayload,
  resolvePiAuthProviderForSubmit,
  type PresetKey,
} from "./submit-helpers"

import type { CustomEndpointApi, CustomEndpointConfig } from '@config/llm-connections'
import { useInitialFocus } from '@phaneris/ui'

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export type { CustomEndpointApi }

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  brandId?: string
  connectionDefaultModel?: string
  utilityModel?: string | null
  models?: string[]
  piAuthProvider?: string
  modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
  /** Custom endpoint protocol — set when user configures an arbitrary API endpoint */
  customEndpoint?: CustomEndpointConfig
  /** IAM credentials for Pi+Bedrock (piAuthProvider='amazon-bedrock') setup */
  iamCredentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  /** AWS region for Pi+Bedrock */
  awsRegion?: string
  /** Bedrock authentication method — determines auth type for Pi+Bedrock connections */
  bedrockAuthMethod?: 'iam_credentials' | 'environment'
}

export interface ApiKeyInputProps {
  /** Current validation status */
  status: ApiKeyStatus
  /** Error message to display when status is 'error' */
  errorMessage?: string
  /** Called when the form is submitted with the key and optional endpoint config */
  onSubmit: (data: ApiKeySubmitData) => void
  /** Form ID for external submit button binding (default: "api-key-form") */
  formId?: string
  /** Disable the input (e.g. during validation) */
  disabled?: boolean
  /** Provider type determines which presets and placeholders to show */
  providerType?: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key'
  /** Pre-fill values when editing an existing connection */
  /** Optional provider allowlist for a feature-specific setup flow. */
  allowedPresets?: readonly string[]
  initialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    utilityModel?: string
    activePreset?: string
    models?: string[]
    /** Pre-fill the protocol toggle for custom endpoints */
    customApi?: CustomEndpointApi
  }
}

interface Preset {
  key: PresetKey
  label: string
  url: string
  placeholder?: string
}

// Anthropic-compatible provider presets - routed via the Pi backend
// Also used by Pi API key flow (same providers, routed via Pi SDK)
const ANTHROPIC_PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com', placeholder: 'sk-ant-...' },
  { key: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-eu', label: 'OpenAI EU', url: 'https://eu.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-us', label: 'OpenAI US', url: 'https://us.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'google', label: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta', placeholder: 'AIza...' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-...' },
  { key: 'azure-openai-responses', label: 'Azure OpenAI', url: '', placeholder: 'Paste your key here...' },
  { key: 'amazon-bedrock', label: 'Amazon Bedrock', url: 'https://bedrock-runtime.us-east-1.amazonaws.com', placeholder: 'AKIA...' },
  { key: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', placeholder: 'gsk_...' },
  { key: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1', placeholder: 'Paste your key here...' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', placeholder: 'sk-...' },
  { key: 'xai', label: 'xAI (Grok)', url: 'https://api.x.ai/v1', placeholder: 'xai-...' },
  { key: 'cerebras', label: 'Cerebras', url: 'https://api.cerebras.ai/v1', placeholder: 'csk-...' },
  { key: 'zai', label: 'z.ai (GLM)', url: 'https://api.z.ai/api/coding/paas/v4', placeholder: 'Paste your key here...' },
  { key: 'huggingface', label: 'Hugging Face', url: 'https://router.huggingface.co/v1', placeholder: 'hf_...' },
  { key: 'minimax', label: 'Minimax Global', url: 'https://api.minimax.io/anthropic', placeholder: 'Paste your key here...' },
  { key: 'minimax-cn', label: 'Minimax CN', url: 'https://api.minimaxi.com/anthropic', placeholder: 'Paste your key here...' },
  // Kimi Coding's native provider speaks Chat Completions at /coding/v1 (the Pi
  // SDK catalog owns that URL); the preset must show the same endpoint the SDK
  // will actually call.
  { key: 'kimi-coding', label: 'Kimi (Coding)', url: 'https://api.kimi.com/coding/v1', placeholder: 'sk-kimi-...' },
  { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh', placeholder: 'Paste your key here...' },
  { key: 'nvidia', label: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', placeholder: 'nvapi-...' },
  { key: 'together', label: 'Together AI', url: 'https://api.together.xyz/v1', placeholder: 'Paste your key here...' },
  { key: 'fireworks', label: 'Fireworks AI', url: 'https://api.fireworks.ai/inference/v1', placeholder: 'fw_...' },
  { key: 'moonshotai', label: 'Moonshot AI', url: 'https://api.moonshot.ai/v1', placeholder: 'sk-...' },
  { key: 'moonshotai-cn', label: 'Moonshot AI CN', url: 'https://api.moonshot.cn/v1', placeholder: 'sk-...' },
  { key: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', url: 'https://api.cloudflare.com/client/v4/accounts', placeholder: 'Paste your key here...' },
  { key: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', url: 'https://gateway.ai.cloudflare.com/v1', placeholder: 'Paste your key here...' },
  { key: 'ant-ling', label: 'Ant Ling', url: '', placeholder: 'Paste your key here...' },
  { key: 'zai-coding-cn', label: 'z.ai Coding CN', url: 'https://api.z.ai/cn/api/coding/paas/v4', placeholder: 'Paste your key here...' },
  // OpenCode's catalog serves each protocol family from its own base URL
  // (anthropic-messages, google-generative-ai, openai-completions,
  // openai-responses), so a single preset URL cannot describe it. The Pi SDK
  // catalog owns the endpoint and the protocol per model.
  { key: 'opencode', label: 'OpenCode', url: '', placeholder: 'sk-...' },
  { key: 'opencode-go', label: 'OpenCode Zen Go', url: '', placeholder: 'sk-...' },
  { key: 'xiaomi', label: 'Xiaomi LLM', url: '', placeholder: 'Paste your key here...' },
  { key: 'manifest', label: 'Manifest', url: 'https://app.manifest.build/v1', placeholder: 'mnfst_...' },
  { key: 'custom', label: 'Custom', url: '', placeholder: 'Paste your key here...' },
]

/**
 * Presets without a Pi SDK provider entry that nonetheless expose a known
 * OpenAI-compatible protocol. They behave like 'custom' on submit (customEndpoint
 * gets pinned to openai-completions) but stay branded in the dropdown.
 */
const OPENAI_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set(['manifest'])

// OpenAI provider presets - for Codex backend
// Only direct OpenAI is supported; 3PP providers (OpenRouter, Vercel, Ollama) should be
// configured via the Claude connection which routes through the Pi backend.
const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
]

// Pi provider presets - unified API for 20+ LLM providers
const PI_PRESETS: Preset[] = [
  { key: 'pi', label: 'Phaneris Backend (Direct)', url: '' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'custom', label: 'Custom', url: '' },
]

// Google AI Studio preset - single endpoint, no custom URL needed
const GOOGLE_PRESETS: Preset[] = [
  { key: 'google', label: 'Google AI Studio', url: '' },
]

/** Presets that require the Pi SDK for authentication — hidden in Anthropic API Key mode */
const PI_ONLY_PRESET_KEYS: ReadonlySet<string> = new Set(['minimax', 'minimax-cn'])

function getPresetsForProvider(providerType: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key'): Preset[] {
  if (providerType === 'pi_api_key') return ANTHROPIC_PRESETS
  if (providerType === 'google') return GOOGLE_PRESETS
  if (providerType === 'pi') return PI_PRESETS
  if (providerType === 'openai') return OPENAI_PRESETS
  // Anthropic mode: exclude presets that only work via Pi SDK
  return ANTHROPIC_PRESETS.filter(p => !PI_ONLY_PRESET_KEYS.has(p.key))
}

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  providerType = 'anthropic',
  initialValues,
  allowedPresets,
}: ApiKeyInputProps) {
  // Get presets based on provider type
  const presets = getPresetsForProvider(providerType).filter(preset => !allowedPresets || allowedPresets.includes(preset.key))
  if (!presets.length) throw new Error('No supported API providers in this setup flow')
  const defaultPreset = presets[0]

  // Compute initial preset: explicit (Pi piAuthProvider), derived from URL, or default
  const requestedPreset = initialValues?.activePreset
    ?? (initialValues?.baseUrl ? getPresetForUrl(initialValues.baseUrl, presets) : defaultPreset.key)
  const initialPreset = allowedPresets && !presets.some(p => p.key === requestedPreset) ? defaultPreset.key : requestedPreset

  const { t } = useTranslation()
  const initialFocusRef = useInitialFocus<HTMLInputElement>()
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(initialPreset)
  const [lastNonCustomPreset, setLastNonCustomPreset] = useState<PresetKey | null>(
    initialPreset !== 'custom' ? initialPreset : defaultPreset.key
  )
  const [connectionDefaultModel, setConnectionDefaultModel] = useState('')
  const isLegacyCustomResponses = initialValues?.customApi === 'openai-responses'
  const [customApi, setCustomApi] = useState<CustomEndpointApi>(
    isLegacyCustomResponses ? 'openai-completions' : (initialValues?.customApi ?? 'openai-completions'),
  )
  const [modelError, setModelError] = useState<string | null>(null)

  // Bedrock auth state
  const [bedrockAuthMethod, setBedrockAuthMethod] = useState<'iam_credentials' | 'environment'>('iam_credentials')
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('')
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('')
  const [awsSessionToken, setAwsSessionToken] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')

  const isDisabled = disabled || status === 'validating'

  const isPiApiKeyFlow = providerType === 'pi_api_key'
  const isBedrock = activePreset === 'amazon-bedrock'
  const requiresEndpoint = activePreset === 'custom' || ['azure-openai-responses', 'cloudflare-workers-ai', 'cloudflare-ai-gateway'].includes(activePreset)
  const sameConnection = activePreset === initialPreset && (activePreset !== 'custom'
    || (baseUrl.trim() === initialValues?.baseUrl?.trim()
      && customApi === (isLegacyCustomResponses ? 'openai-completions' : initialValues?.customApi ?? 'openai-completions')))

  // Provider-specific placeholders from the active preset
  const activePresetObj = presets.find(p => p.key === activePreset)
  const apiKeyPlaceholder = activePresetObj?.placeholder
    ?? (providerType === 'google' ? 'AIza...'
    : providerType === 'pi' ? 'pi-...'
    : providerType === 'openai' ? 'sk-...'
    : 'Paste your key here...')

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key !== 'custom') {
      setLastNonCustomPreset(preset.key)
    }
    if (preset.key === 'custom') {
      // Custom starts empty — the user types the endpoint themselves. Typing a
      // URL never auto-switches the preset (see handleBaseUrlChange), so a
      // known endpoint like https://api.deepseek.com pairs freely with any
      // protocol chosen below.
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    setModelError(null)
    setConnectionDefaultModel('')
  }

  const handleBaseUrlChange = (value: string) => {
    // Typing a URL never auto-switches the preset: known endpoints (e.g.
    // https://api.deepseek.com) can be paired with any protocol (Chat
    // Completions or Responses), so preset selection stays fully explicit.
    setBaseUrl(value)
    setConnectionDefaultModel('')
    setModelError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isDisabled) return
    if (requiresEndpoint && !baseUrl.trim()) {
      setModelError(t('apiSetup.endpointRequired'))
      return
    }

    const effectivePiAuthProvider = resolvePiAuthProviderForSubmit(activePreset, lastNonCustomPreset)

    // Bedrock — routes through Pi SDK with piAuthProvider='amazon-bedrock'.
    // Submit with auth method and optional IAM credentials.
    if (isBedrock) {
      if (bedrockAuthMethod === 'iam_credentials' && !awsAccessKeyId.trim()) {
        setModelError('Access Key ID is required for IAM authentication.')
        return
      }
      if (bedrockAuthMethod === 'iam_credentials' && !awsSecretAccessKey.trim()) {
        setModelError('Secret Access Key is required for IAM authentication.')
        return
      }
      const parsedModels = parseModelList(connectionDefaultModel)
      onSubmit({
        apiKey: '',
        piAuthProvider: effectivePiAuthProvider,
        bedrockAuthMethod,
        awsRegion: awsRegion.trim() || 'us-east-1',
        ...(bedrockAuthMethod === 'iam_credentials' ? {
          iamCredentials: {
            accessKeyId: awsAccessKeyId.trim(),
            secretAccessKey: awsSecretAccessKey.trim(),
            ...(awsSessionToken.trim() ? { sessionToken: awsSessionToken.trim() } : {}),
          },
        } : {}),
        connectionDefaultModel: parsedModels[0],
        models: parsedModels.length > 0 ? parsedModels : undefined,
      })
      return
    }

    const effectiveBaseUrl = baseUrl.trim()

    const parsedModels = parseModelList(connectionDefaultModel)

    // Include custom endpoint protocol when user configured a custom base URL.
    // Branded openai-compat presets (e.g. Manifest) are pinned to openai-completions
    // and routed via the Pi SDK's openai adapter.
    const { customEndpoint, piAuthProvider: resolvedPiAuthProvider } = resolveCustomEndpointPayload({
      activePreset,
      baseUrl: effectiveBaseUrl,
      customApi,
      brandedOpenAiCompatPresets: OPENAI_COMPAT_CUSTOM_URL_PRESETS,
      fallbackPiAuthProvider: effectivePiAuthProvider,
    })

    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: requiresEndpoint || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)
        ? effectiveBaseUrl : '',
      brandId: activePreset,
      connectionDefaultModel: activePreset === 'custom' && parsedModels.length
        ? parsedModels[0] : sameConnection ? initialValues?.connectionDefaultModel : undefined,
      utilityModel: sameConnection ? initialValues?.utilityModel : undefined,
      models: activePreset === 'custom' && parsedModels.length
        ? parsedModels : sameConnection ? initialValues?.models : undefined,
      piAuthProvider: resolvedPiAuthProvider,
      modelSelectionMode: isPiApiKeyFlow ? 'automaticallySyncedFromProvider' : undefined,
      customEndpoint,
    })
  }

  return (
    <form data-testid="api-key-input" id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key — hidden for Bedrock (uses IAM/Environment auth) */}
      {!isBedrock && (<div className="space-y-2">
        <Label htmlFor="api-key">API Key</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="api-key"
            type={showValue ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            ref={initialFocusRef}
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="craft-control absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showValue ? t("apiSetup.hideKey") : t("apiSetup.showKey")}
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>)}

      {/* Endpoint/Provider Preset Selector - hidden when only one preset (e.g. Codex/OpenAI direct) */}
      {presets.length > 1 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="api-key-preset">{t("apiSetup.provider")}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              id="api-key-preset"
              type="button"
              data-testid="api-key-preset-trigger"
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-shape-md bg-background shadow-minimal pl-2.5 pr-2 text-label font-medium text-text-secondary hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {presets.find(p => p.key === activePreset)?.label}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {presets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  {preset.label}
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Instance addresses are only needed for Custom and resource-specific providers. */}
        {requiresEndpoint && (
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="base-url"
              aria-label={t("apiSetup.endpoint")}
              type="url"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://your-api-endpoint.com"
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
        )}
      </div>
      )}

      {/* Protocol Toggle — visible as soon as Custom preset is selected */}
      {activePreset === 'custom' && (
        <div className="space-y-2">
          <Label>{t("apiSetup.protocol")}</Label>
          <div className={cn(
            "flex rounded-md shadow-minimal overflow-hidden",
            "bg-foreground-2",
            isDisabled && "opacity-50 pointer-events-none"
          )}>
            {([
              { value: 'openai-completions' as const, label: t('apiSetup.openaiCompatible') },
              { value: 'anthropic-messages' as const, label: t('apiSetup.anthropicCompatible') },
            ]).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                disabled={isDisabled}
                aria-pressed={customApi === value}
                onClick={() => { setCustomApi(value); setConnectionDefaultModel(''); setModelError(null) }}
                className={cn(
                  "craft-control flex-1 py-1.5 text-label font-medium transition-colors",
                  customApi === value
                    ? "bg-background text-foreground shadow-minimal"
                    : "text-text-secondary hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-meta text-text-secondary">
            {isLegacyCustomResponses
              ? t('apiSetup.legacyResponsesHint')
              : t('apiSetup.protocolHint')}
          </p>
        </div>
      )}

      {/* Bedrock Auth Section */}
      {isBedrock && (
        <>
          {/* Auth Method Toggle */}
          <div className="space-y-2">
            <Label>Authentication</Label>
            <div className={cn(
              "flex rounded-md shadow-minimal overflow-hidden",
              "bg-foreground-2",
              isDisabled && "opacity-50 pointer-events-none"
            )}>
              {([
                { value: 'iam_credentials' as const, label: 'IAM Credentials' },
                { value: 'environment' as const, label: 'Environment (AWS CLI)' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setBedrockAuthMethod(value)}
                  className={cn(
                    "craft-control flex-1 py-1.5 text-label font-medium transition-colors",
                    bedrockAuthMethod === value
                      ? "bg-background text-foreground shadow-minimal"
                      : "text-text-secondary hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* IAM Credential Fields */}
          {bedrockAuthMethod === 'iam_credentials' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="aws-access-key-id" className="text-muted-foreground font-normal text-meta">
                  Access Key ID
                </Label>
                <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-access-key-id"
                    type="text"
                    value={awsAccessKeyId}
                    onChange={(e) => setAwsAccessKeyId(e.target.value)}
                    placeholder="AKIA..."
                    className="border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                    ref={initialFocusRef}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aws-secret-key" className="text-muted-foreground font-normal text-meta">
                  Secret Access Key
                </Label>
                <div className={cn("relative rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-secret-key"
                    type={showValue ? 'text' : 'password'}
                    value={awsSecretAccessKey}
                    onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                    placeholder={t("apiSetup.secretAccessKey")}
                    className="pr-10 border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                  />
                  <button
                    type="button"
                    onClick={() => setShowValue(!showValue)}
                    className="craft-control absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showValue ? t("apiSetup.hideKey") : t("apiSetup.showKey")}
                    tabIndex={-1}
                  >
                    {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aws-session-token" className="text-muted-foreground font-normal text-meta">
                  Session Token <span className="text-text-secondary">· optional</span>
                </Label>
                <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-session-token"
                    type="text"
                    value={awsSessionToken}
                    onChange={(e) => setAwsSessionToken(e.target.value)}
                    placeholder={t("apiSetup.temporaryCredentials")}
                    className="border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Environment info */}
          {bedrockAuthMethod === 'environment' && (
            <div className="rounded-md bg-foreground-2 p-3">
              <p className="text-meta text-text-secondary">
                Uses your existing AWS credential chain — <code className="text-text-secondary">~/.aws/credentials</code>, <code className="text-text-secondary">AWS_PROFILE</code>, IAM roles, SSO sessions, and environment variables.
              </p>
            </div>
          )}

          {/* AWS Region */}
          <div className="space-y-1.5">
            <Label htmlFor="aws-region" className="text-muted-foreground font-normal text-meta">
              AWS Region
            </Label>
            <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
              <Input
                id="aws-region"
                type="text"
                value={awsRegion}
                onChange={(e) => setAwsRegion(e.target.value)}
                placeholder="us-east-1"
                className="border-0 bg-transparent shadow-none"
                disabled={isDisabled}
              />
            </div>
          </div>
        </>
      )}

      {activePreset === 'custom' && (
        <details className="space-y-2">
          <summary className="craft-control cursor-pointer text-meta text-text-secondary">
            {t('apiSetup.manualModels')}
          </summary>
          <div className="space-y-2 pt-2">
            <Label htmlFor="connection-default-model">{t('apiSetup.modelIds')}</Label>
            <Input
              id="connection-default-model"
              value={connectionDefaultModel}
              onChange={e => { setConnectionDefaultModel(e.target.value); setModelError(null) }}
              disabled={isDisabled}
              aria-describedby="manual-models-hint"
            />
            <p id="manual-models-hint" className="text-meta text-text-secondary">
              {t('apiSetup.manualModelsHint')}
            </p>
          </div>
        </details>
      )}
      {modelError && <p role="alert" className="text-body text-destructive">{modelError}</p>}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-body text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
