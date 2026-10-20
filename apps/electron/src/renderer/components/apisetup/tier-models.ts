export interface PiModelInfo {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

/**
 * Resolve a saved default against the current provider-owned catalog.
 *
 * A saved default is returned verbatim even when the catalog no longer lists it.
 * Substituting the catalog's first entry would silently change which model the
 * user's connection runs on — the catalog is a snapshot of what the provider
 * offers today, not an authority over an existing connection's choice (it may be
 * a model the catalog dropped, a renamed id, or a user model).
 */
export function resolveDefaultCatalogModel(models: PiModelInfo[], savedDefault?: string): string {
  if (savedDefault) return savedDefault
  return models[0]?.id ?? ''
}
