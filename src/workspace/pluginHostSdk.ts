import { createElement } from 'react'
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'
import { definePlugin } from './definePlugin.ts'

type HostElementProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

type SelectOption = {
  label: string
  value: string
}

export type PluginHostUi = {
  Button: (props: ComponentPropsWithoutRef<'button'>) => ReactNode
  TextInput: (props: ComponentPropsWithoutRef<'input'>) => ReactNode
  Select: (props: Omit<ComponentPropsWithoutRef<'select'>, 'children'> & { options: SelectOption[] }) => ReactNode
  Checkbox: (props: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { label?: ReactNode }) => ReactNode
  Stack: (props: HostElementProps & { gap?: number | string }) => ReactNode
  Text: (props: HostElementProps) => ReactNode
  CodeBlock: (props: HostElementProps) => ReactNode
  EmptyState: (props: HostElementProps) => ReactNode
}

export type PluginHostSdk = {
  definePlugin: typeof definePlugin
  effects: {
    replaceActiveText: (text: string) => { type: 'text.replace'; target: 'active-input'; text: string }
    createPane: (text: string, title?: string) => { type: 'pane.create'; pane: { text: string; title?: string }; focus: boolean }
    status: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => { type: 'status.message'; level: 'info' | 'success' | 'warning' | 'error'; message: string }
  }
  ui: PluginHostUi
}

export function createPluginHostSdk(): PluginHostSdk {
  return {
    definePlugin,
    effects: {
      replaceActiveText: (text) => ({ type: 'text.replace' as const, target: 'active-input' as const, text }),
      createPane: (text, title) => ({ type: 'pane.create' as const, pane: { text, title }, focus: true }),
      status: (message, level = 'info') => ({ type: 'status.message' as const, level, message }),
    },
    ui: createPluginHostUi(),
  }
}

function createPluginHostUi(): PluginHostUi {
  return {
    Button: ({ className = '', style, ...props }) => createElement('button', {
      ...props,
      className: ['scripts-btn', className].filter(Boolean).join(' '),
      style,
    }),
    TextInput: ({ className = '', style, ...props }) => createElement('input', {
      ...props,
      className: ['debug-input', className].filter(Boolean).join(' '),
      style,
    }),
    Select: ({ className = '', style, options, ...props }) => createElement(
      'select',
      {
        ...props,
        className: ['debug-input', className].filter(Boolean).join(' '),
        style,
      },
      options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
    ),
    Checkbox: ({ className = '', style, label, ...props }) => createElement(
      'label',
      {
        className: ['flex items-center gap-2 text-[12px]', className].filter(Boolean).join(' '),
        style: { color: 'var(--color-text-secondary)', ...style },
      },
      createElement('input', { ...props, type: 'checkbox' }),
      label,
    ),
    Stack: ({ children, className = '', style, gap = 8 }) => createElement('div', {
      className: ['flex flex-col', className].filter(Boolean).join(' '),
      style: { gap, ...style },
    }, children),
    Text: ({ children, className = '', style }) => createElement('span', {
      className,
      style: { color: 'var(--color-text-secondary)', ...style },
    }, children),
    CodeBlock: ({ children, className = '', style }) => createElement('pre', {
      className,
      style: {
        margin: 0,
        padding: 8,
        borderRadius: 6,
        background: 'var(--color-background-secondary)',
        color: 'var(--color-text-primary)',
        overflow: 'auto',
        ...style,
      },
    }, children),
    EmptyState: ({ children, className = '', style }) => createElement('div', {
      className: ['flex items-center justify-center p-4 text-[12px]', className].filter(Boolean).join(' '),
      style: { color: 'var(--color-text-tertiary)', ...style },
    }, children),
  }
}
