import { readFile } from 'node:fs/promises'
import type { FileAttachment } from '@phaneris/shared/protocol'
import * as modelConfig from '@phaneris/shared/config'
import type { LlmConnection, ModelDefinition } from '@phaneris/shared/config'
import { getPiModelsForAuthProvider } from '@phaneris/shared/config/models-pi'
import { filterAttachmentsForModelInput, isImageAttachment } from './runtime-config'
import { getImageSize, resizeImageForAPI } from '../services/image-utils'

/** Derive the request projection from original attachments. Never modify persisted evidence. */
export async function prepareAttachmentsForModelInput(attachments: FileAttachment[] | undefined, connection: LlmConnection | null,
  modelId: string, metadata?: Pick<ModelDefinition, 'inputLimits' | 'supportsImages'>) {
  const custom = connection?.models?.find(model => typeof model !== 'string' && model.id === modelId)
  const nativeProvider = connection?.piAuthProvider
  const native = nativeProvider ? getPiModelsForAuthProvider(nativeProvider).find(model => model.id.replace(/^pi\//, '') === modelId.replace(/^pi\//, '')) : modelConfig.getModelById(modelId)
  const model = metadata ?? { ...native, ...(typeof custom === 'object' ? custom : {}) }
  const filtered = filterAttachmentsForModelInput(attachments, connection, modelId)
  if (model?.supportsImages === false) {
    return { attachments: filtered.attachments?.filter(a => !isImageAttachment(a)), omittedImages: attachments?.filter(isImageAttachment) ?? [] }
  }
  const images = filtered.attachments?.filter(isImageAttachment) ?? []
  const limits = model?.inputLimits
  const maxImages = Math.min(limits?.images?.maxPerMessage ?? Infinity, limits?.images?.maxPerRequest ?? Infinity)
  if (images.length > maxImages) throw new Error(`${modelId} image input limit is ${maxImages}; this message has ${images.length} images. Keep the originals and send fewer images.`)
  if (!images.length || !limits) return filtered
  const projected: FileAttachment[] = []
  for (const attachment of filtered.attachments ?? []) {
    if (!isImageAttachment(attachment)) { projected.push(attachment); continue }
    const resize = limits.images?.resize
    const bytes = attachment.base64 ? Buffer.from(attachment.base64, 'base64') : await readFile(attachment.path)
    const dimensions = await getImageSize(bytes)
    const needsResize = resize && ((!dimensions || dimensions.width > (resize.maxWidth ?? Infinity) || dimensions.height > (resize.maxHeight ?? Infinity)) || bytes.length > (resize.maxBytes ?? Infinity))
    if (needsResize) {
      const result = await resizeImageForAPI(bytes, { maxWidth: resize.maxWidth, maxHeight: resize.maxHeight, maxSizeBytes: resize.maxBytes, jpegQuality: resize.jpegQuality })
      if (!result) throw new Error(`Cannot fit ${attachment.name} within ${modelId}'s image input limits. The original is preserved.`)
      projected.push({ ...attachment, base64: result.buffer.toString('base64'), mimeType: `image/${result.format}`, size: result.buffer.length })
    } else projected.push({ ...attachment, base64: bytes.toString('base64') })
  }
  // This is a lower bound; the SDK checks the complete request including history.
  const imagePayloadBytes = projected.filter(isImageAttachment).reduce((n, a) => n + (a.base64?.length ?? 0), 0)
  if (limits.maxRequestBytes && imagePayloadBytes > limits.maxRequestBytes) throw new Error(`${modelId} image payload exceeds its request byte limit. Send fewer images; the originals are preserved.`)
  return { ...filtered, attachments: projected }
}
