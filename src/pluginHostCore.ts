import { createElement } from 'react'
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'
import { definePlugin } from './workspace/definePlugin.ts'
import type { CommandContribution, PluginCommandResult } from './workspace/pluginTypes.ts'

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

export type PluginHostEffects = {
  replaceActiveText: (text: string) => { type: 'text.replace'; target: 'active-input'; text: string }
  createPane: (text: string, title?: string) => { type: 'pane.create'; pane: { text: string; title?: string }; focus: boolean }
  showMainPanel: () => { type: 'app.showMainPanel' }
  status: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => { type: 'status.message'; level: 'info' | 'success' | 'warning' | 'error'; message: string }
}

/** The monaco-free core SDK: definePlugin, effects, ui. Safe to load in Node. */
export type PluginHostCoreSdk = {
  definePlugin: typeof definePlugin
  effects: PluginHostEffects
  ui: PluginHostUi
  textOutput: typeof textOutput
  textError: typeof textError
  defineTextCommand: typeof defineTextCommand
}

export function createPluginHostCoreSdk(): PluginHostCoreSdk {
  return {
    definePlugin,
    effects: {
      replaceActiveText: (text) => ({ type: 'text.replace' as const, target: 'active-input' as const, text }),
      createPane: (text, title) => ({ type: 'pane.create' as const, pane: { text, title }, focus: true }),
      showMainPanel: () => ({ type: 'app.showMainPanel' as const }),
      status: (message, level = 'info') => ({ type: 'status.message' as const, level, message }),
    },
    ui: createPluginHostUi(),
    textOutput,
    textError,
    defineTextCommand,
  }
}

export function createPluginHostUi(): PluginHostUi {
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

// ─── Text Command Helpers ────────────────────────────────────────────────────

export type TextCommandDefinition = Omit<CommandContribution, 'run' | 'inputs' | 'inputResolution' | 'live'> & {
  inputs?: CommandContribution['inputs']
  inputResolution?: CommandContribution['inputResolution']
  live?: CommandContribution['live']
  transform: (input: string, params: Record<string, unknown>) => string | Promise<string>
}

export function textOutput(text: string): PluginCommandResult {
  return { output: { kind: 'text', text } }
}

export function textError(text: string): PluginCommandResult {
  return { output: { kind: 'error', text } }
}

export function defineTextCommand(command: TextCommandDefinition): CommandContribution {
  const { transform, ...rest } = command
  return {
    ...rest,
    inputs: command.inputs ?? [{ key: 'input', label: 'Input', kind: 'text' as const, required: true }],
    inputResolution: command.inputResolution ?? { strategy: 'use-active' as const, fallback: 'fail' as const },
    live: command.live ?? { live: { enabled: true, trigger: 'on-input' as const, sideEffects: 'none' as const, debounceMs: 250 } },
    async run(ctx) {
      const input = ctx.inputs.input
      const text = input?.kind === 'text' ? input.text : ''
      try {
        return textOutput(await transform(text, ctx.params))
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return textError(`Error: ${message}`)
      }
    },
  }
}
