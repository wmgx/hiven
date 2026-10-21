import { useRef } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { ImageCropPanel } from './ImageCropPanel'
import { ImageRedactionPanel } from './ImageRedactionPanel'
import { ImageResizePanel } from './ImageResizePanel'
import { ImageSavePanel } from './ImageSavePanel'

const TITLES: Record<string, string> = {
  'image-resize': 'resize.title',
  'image-crop': 'crop.title',
  'image-redact': 'redact.title',
  'image-save': 'image.saveRouteTitle',
}

export function ImageToolsSurface(props: PluginSurfaceProps) {
  const { host, t, surfaceId } = props
  const invalidation = useRef<(() => void) | null>(null)
  const noop = () => {}
  const leave = (action: () => void) => () => { invalidation.current?.(); action() }
  const panelProps = { ...props, onDirtyChange: noop, invalidateRef: invalidation }
  return (
    <section className="image-tools-surface" aria-label={t(TITLES[surfaceId] ?? 'surface.title')} data-no-drag>
      <header className="image-tools-header">
        <IconButton type="button" label={t('action.back')} onClick={leave(() => host.requestBack())}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t(TITLES[surfaceId] ?? 'surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={leave(() => host.close())}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>
      {surfaceId === 'image-crop' ? <ImageCropPanel {...panelProps} />
        : surfaceId === 'image-redact' ? <ImageRedactionPanel {...panelProps} />
        : surfaceId === 'image-save' ? <ImageSavePanel {...props} invalidateRef={invalidation} />
        : <ImageResizePanel {...panelProps} />}
    </section>
  )
}
