import type { LlmConnectionWithStatus } from '../../shared/types'
import { getModelShortName } from '@config/models'
import { getModelsForProviderType } from '@config/llm-connections'

/** Connection catalogs are authoritative; otherwise use the provider registry. */
export function getModelOptionsForConnection(connection: LlmConnectionWithStatus | undefined) {
  if (!connection) return []
  if (connection.models?.length) {
    return connection.models.map(model => typeof model === 'string'
      ? { value: model, label: getModelShortName(model), description: '', descriptionKey: undefined }
      : { value: model.id, label: model.name, description: model.description, descriptionKey: model.descriptionKey })
  }
  return getModelsForProviderType(connection.providerType, connection.piAuthProvider).map(model => ({
    value: model.id, label: model.name, description: model.description, descriptionKey: model.descriptionKey,
  }))
}

/** Unknown capabilities must never imply image support across a whole catalog. */
export function connectionImageUnderstanding(connection: LlmConnectionWithStatus): 'all' | 'some' | 'none' {
  const registry = getModelsForProviderType(connection.providerType, connection.piAuthProvider)
  const models = connection.models?.length ? connection.models : registry
  const count = models.filter(model => typeof model === 'string'
    ? registry.find(entry => entry.id === model)?.supportsImages === true
    : model.supportsImages === true).length
  return count === 0 ? 'none' : count === models.length ? 'all' : 'some'
}
