import { useRef } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import { AiSubscriptionsContent } from '../../surfaces/SettingsContent'

/** This overlay leaves the plugin component in its existing React position. */
export function PluginAppSettingsDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1200] bg-black/40" />
        <Dialog.Popup
          initialFocus={closeRef}
          className="fixed left-1/2 top-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden"
          style={{
            width: 'min(780px, calc(100vw - 24px))',
            height: 'min(680px, calc(100vh - 24px))',
            background: 'var(--color-background-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-panel)',
            outline: 'none',
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-secondary)' }}>
            <Dialog.Title className="text-[14px] font-medium">{t(locale, 'systemSettings.aiSubscriptions')}</Dialog.Title>
            <Dialog.Close ref={closeRef} className="scripts-btn" aria-label={t(locale, 'scripts.settingsClose')}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <AiSubscriptionsContent />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
