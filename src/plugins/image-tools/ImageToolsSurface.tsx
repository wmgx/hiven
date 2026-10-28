import { useEffect, useRef } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ImageBase64Panel } from './ImageBase64Panel'
import { ImageCropPanel } from './ImageCropPanel'
import { ImageRedactionPanel } from './ImageRedactionPanel'
import { ImageResizePanel } from './ImageResizePanel'
import { ImageSavePanel } from './ImageSavePanel'

const TITLES: Record<string, string> = {
  'image-base64': 'image.title',
  'image-resize': 'resize.title',
  'image-crop': 'crop.title',
  'image-redact': 'redact.title',
  'image-save': 'image.saveRouteTitle',
}

export function ImageToolsSurface(props: PluginSurfaceProps) {
  const { host, t, surfaceId } = props
  const invalidation = useRef<(() => void) | null>(null)
  const noop = () => {}
  useEffect(() => host.subscribeLeaveIntent?.(() => invalidation.current?.()), [host.subscribeLeaveIntent])
  const panelProps = { ...props, onDirtyChange: noop, invalidateRef: invalidation }
  return (
    <section className="image-tools-surface" aria-label={t(TITLES[surfaceId] ?? 'surface.title')}>
      {surfaceId === 'image-base64' ? <ImageBase64Panel {...panelProps} active />
        : surfaceId === 'image-crop' ? <ImageCropPanel {...panelProps} />
        : surfaceId === 'image-redact' ? <ImageRedactionPanel {...panelProps} />
        : surfaceId === 'image-save' ? <ImageSavePanel {...props} invalidateRef={invalidation} />
        : <ImageResizePanel {...panelProps} />}
    </section>
  )
}
