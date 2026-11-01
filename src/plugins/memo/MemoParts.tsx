import { Fragment, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, Button, CopyIconButton, Menu, useLocalEscapeLayer, type MenuItemSpec } from '@hiven/plugin-ui'

export type Host = PluginSurfaceProps['host']
export type T = PluginSurfaceProps['t']

/** Mark every occurrence of the query words, case-insensitively. */
export function Hl({ text, words }: { text: string; words: string[] }) {
  if (!words.length || !text) return <>{text}</>
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const word of words) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) marked.fill(true, at, at + word.length)
  }
  const parts: Array<{ text: string; on: boolean }> = []
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.on === marked[i]) last.text += text[i]
    else parts.push({ text: text[i], on: marked[i] })
  }
  return <>{parts.map((part, i) => part.on ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>)}</>
}

/** Every copy says what it copied: a field, a cell, a paragraph or the whole record. */
export function useCopy(host: Host, t: T) {
  return async (text: string, scope: string) => {
    try {
      await host.clipboard.writeText(text)
      host.showToast(t('toast.copied', { scope }), 'success')
    } catch {
      host.showToast(t('toast.copyFailed'), 'error')
      throw new Error('copy failed')
    }
  }
}

export function CopyButton({ label, copy }: { label: string; copy: () => Promise<void> }) {
  return <CopyIconButton className="memo-copy" label={label} copy={copy} />
}

export type FooterAction = { label: string; keys: string; run: () => void; disabled?: boolean }

/** Footer actions plus the ⌘K menu; `menuRef` lets the view open the menu from the keyboard. */
export function Footer({ actions, menu, menuRef, t }: { actions: FooterAction[]; menu: MenuItemSpec[]; menuRef: RefObject<HTMLButtonElement | null>; t: T }) {
  return <ActionBar>
    {actions.map(action => <Button key={action.label} variant="ghost" disabled={action.disabled} onMouseDown={event => event.preventDefault()} onClick={action.run}>
      {action.label}{action.keys.split(' ').map(key => <kbd key={key}>{key}</kbd>)}
    </Button>)}
    {menu.length > 0 && <Menu align="end" items={menu}
      trigger={<Button ref={menuRef} variant="ghost" onMouseDown={event => event.preventDefault()}>{t('action.more')}<kbd>⌘</kbd><kbd>K</kbd></Button>} />}
  </ActionBar>
}

/** Esc inside the plugin goes back one step; the host only sees it on the first page. */
export function useBackLayer(host: Host, refs: Array<RefObject<HTMLElement | null>>, composingRef: RefObject<boolean>, open: boolean, onBack: () => void) {
  // One layer per element that can hold focus (the body and the header field).
  useLocalEscapeLayer({ open, triggerRef: refs[0], popupRef: refs[0], owner: host.deliveryFeedbackOwner, composingRef, onDismiss: onBack })
  useLocalEscapeLayer({ open: open && refs.length > 1, triggerRef: refs[1] ?? refs[0], popupRef: refs[1] ?? refs[0], owner: host.deliveryFeedbackOwner, composingRef, onDismiss: onBack })
}

export function Tags({ host, own, shared, sharedHint, onRemove, onAdd, addLabel, t }: {
  host: Host; own: string[]; shared?: string[]; sharedHint?: string; onRemove?: (index: number) => void; onAdd?: (tag: string) => void; addLabel: string; t: T
}) {
  const [adding, setAdding] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  // Esc in the tag field closes the field, not the page.
  useLocalEscapeLayer({ open: adding, triggerRef: input, popupRef: input, owner: host.deliveryFeedbackOwner, composingRef: composing, onDismiss: () => setAdding(false) })
  return <div className="memo-tags">
    {shared?.map(tag => <span key={`s-${tag}`} className="memo-chip is-shared" title={sharedHint}>{tag}</span>)}
    {own.map((tag, index) => <span key={`o-${tag}`} className="memo-chip">{tag}
      {onRemove && <button type="button" aria-label={t('tag.remove', { tag })} onClick={() => onRemove(index)}>×</button>}</span>)}
    {onAdd && (adding
      ? <input ref={input} autoFocus className="memo-tag-input" placeholder={t('tag.placeholder')}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onBlur={() => setAdding(false)}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation()
            const tag = event.currentTarget.value.trim()
            if (tag) { onAdd(tag); event.currentTarget.value = '' }
          }
        }} />
      : <button type="button" className="memo-add" onClick={() => setAdding(true)}>+ {addLabel}</button>)}
  </div>
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="memo-section"><header>{title}{action}</header>{children}</section>
}
