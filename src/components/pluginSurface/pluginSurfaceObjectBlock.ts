import type { PluginObjectBlockInput } from '../../workspace/pluginTypes'
import { createHistoryItemObjectBlock, createToolResultObjectBlock } from '../../launcher/clipboard/objectBlock'

/** Map the declared origin only; plugin identity and content never imply origin. */
export function createPluginSurfaceObjectBlock(input: PluginObjectBlockInput) {
  if (input.kind === 'text') {
    return input.source === 'tool-result'
      ? createToolResultObjectBlock(input.text)
      : createHistoryItemObjectBlock({ kind: 'text', text: input.text, ageLabel: input.ageLabel })
  }
  if (input.kind === 'image') {
    return createHistoryItemObjectBlock({
      kind: 'image', blobId: input.blobId, contentType: input.contentType,
      width: input.width, height: input.height, ageLabel: input.ageLabel,
    })
  }
  return createHistoryItemObjectBlock({
    kind: 'files', paths: input.paths, fileNames: input.fileNames, ageLabel: input.ageLabel,
  })
}
