#!/usr/bin/env node

/**
 * Plugin settings schema contract
 *
 * Plugin settings should be host-renderable from a declarative schema, while
 * still allowing legacy custom components and schema-declared modal pages.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  settingsDialog: read('src/components/PluginSettingsDialog.tsx'),
  css: read('src/index.css'),
  webOpen: read('src/plugins/web-open/index.tsx'),
  clipboardHistory: read('src/plugins/clipboard-history/index.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:plugin-settings-schema'],
  'node scripts/test-plugin-settings-schema.mjs',
  'package.json must expose test:plugin-settings-schema',
)

assert.match(files.pluginTypes, /export type PluginSettingsSchema</, 'pluginTypes must expose PluginSettingsSchema')
assert.match(files.pluginTypes, /export type PluginSettingsField</, 'pluginTypes must expose PluginSettingsField')
assert.match(files.pluginTypes, /kind:\s*'switch'/, 'settings schema must support switch fields')
assert.match(files.pluginTypes, /kind:\s*'number'/, 'settings schema must support number fields')
assert.match(files.pluginTypes, /kind:\s*'select'/, 'settings schema must support select fields')
assert.match(files.pluginTypes, /kind:\s*'text'/, 'settings schema must support text fields')
assert.match(files.pluginTypes, /kind:\s*'textarea'/, 'settings schema must support textarea fields')
assert.match(files.pluginTypes, /mono\??:\s*boolean/, 'text and textarea settings should support explicit mono rendering')
assert.match(files.pluginTypes, /kind:\s*'list'/, 'settings schema must reserve list fields')
assert.match(files.pluginTypes, /kind:\s*'object-list'/, 'settings schema must support object-list fields')
assert.match(files.pluginTypes, /kind:\s*'modal'/, 'settings schema must support schema-declared modal fields')
assert.match(files.pluginTypes, /storageScale\??:\s*number/, 'number settings should support unit-scaled storage values')
assert.match(files.pluginTypes, /export type PluginSettingsModalContribution</, 'pluginTypes must expose settings modal contributions')
assert.match(files.pluginTypes, /modalId\??:\s*string/, 'modal fields must reference a plugin-declared modal id')
assert.match(files.pluginTypes, /modals\??:\s*PluginSettingsModalContribution<TSettings>\[\]/, 'settings contributions must declare modal bodies separately from fields')
assert.match(files.pluginTypes, /schema\??:\s*PluginSettingsSchema<TSettings>/, 'settings contributions must accept a schema')
assert.match(files.pluginTypes, /component\??:\s*ComponentType<PluginSettingsBodyProps<TSettings>>/, 'legacy settings components must be optional fallback')
assert.match(files.pluginTypes, /PluginSettingsModalBodyProps/, 'pluginTypes must expose props for plugin-owned settings modal pages')

const rendererPath = 'src/components/PluginSettingsSchemaRenderer.tsx'
assert.ok(existsSync(join(root, rendererPath)), 'host must include a plugin settings schema renderer component')
const schemaRenderer = read(rendererPath)

assert.match(schemaRenderer, /export function PluginSettingsSchemaRenderer/, 'schema renderer must export PluginSettingsSchemaRenderer')
assert.match(schemaRenderer, /schema\.sections/, 'schema renderer must render schema sections')
assert.match(schemaRenderer, /field\.kind === 'switch'/, 'schema renderer must render switch fields')
assert.match(schemaRenderer, /field\.kind === 'number'/, 'schema renderer must render number fields')
assert.match(schemaRenderer, /field\.kind === 'select'/, 'schema renderer must render select fields')
assert.match(schemaRenderer, /field\.kind === 'textarea'/, 'schema renderer must render textarea fields')
assert.match(schemaRenderer, /field\.mono/, 'schema renderer must honor explicit mono text and textarea fields')
assert.match(schemaRenderer, /field\.kind === 'object-list'/, 'schema renderer must render object-list fields')
assert.match(schemaRenderer, /schema-object-list-card/, 'schema renderer must render object-list cards instead of JSON-only textareas')
assert.match(schemaRenderer, /wr-card/, 'object-list settings should use the designed rule-card shell')
assert.match(schemaRenderer, /wr-aliases/, 'string-list settings should use the designed chip input container')
assert.match(schemaRenderer, /event\.key === 'Backspace'/, 'chip inputs should support deleting the last trigger word with Backspace')
assert.match(schemaRenderer, /storageScale/, 'schema renderer must support unit-scaled number fields')
assert.match(schemaRenderer, /field\.kind === 'modal'/, 'schema renderer must render modal opener fields')
assert.match(schemaRenderer, /onOpenModal\(field\)/, 'schema renderer must delegate modal opening to the host')
assert.doesNotMatch(schemaRenderer, /pluginRegistry|useAppStore|@tauri-apps/, 'schema renderer must stay host-shell agnostic')

assert.match(files.settingsDialog, /PluginSettingsSchemaRenderer/, 'PluginSettingsDialog must use the schema renderer')
assert.match(files.settingsDialog, /contribution\.schema[\s\S]{0,260}<PluginSettingsSchemaRenderer/, 'schema settings must render before legacy component fallback')
assert.match(files.settingsDialog, /const SettingsComponent = contribution\.component[\s\S]{0,2400}<SettingsComponent/, 'legacy component settings must remain as fallback')
assert.match(files.settingsDialog, /settingsModalTarget/, 'settings dialog must support a host-owned plugin settings modal target')
assert.match(files.settingsDialog, /resolvePluginSettingsModal/, 'settings dialog must resolve schema modal fields through plugin-declared modal bodies')
assert.match(files.settingsDialog, /SettingsModalComponent/, 'settings dialog must render plugin-owned modal body components inside host modal shell')

assert.match(files.css, /data-theme=['"]dark['"][\s\S]{0,260}\.schema-field-block input:focus[\s\S]{0,420}border-color:\s*var\(--accent\)[\s\S]{0,120}background:\s*var\(--surface-2\)/, 'dark schema text focus must lift to surface-2 with accent border')
assert.match(files.css, /data-theme=['"]dark['"][\s\S]{0,260}\.schema-select-wrap\.is-open \.schema-select-trigger[\s\S]{0,320}background:\s*var\(--surface-2\)[\s\S]{0,140}var\(--accent\)/, 'dark schema select open state must not use a white background')
assert.match(files.css, /data-theme=['"]dark['"][\s\S]{0,220}\.menu[\s\S]{0,260}rgba\(0,\s*0,\s*0,\s*0\.65\)[\s\S]{0,180}rgba\(255,\s*255,\s*255,\s*0\.05\)/, 'dark menus must use the finalized dark shadow and light outline')

const inlinePath = 'src/components/PluginSettingsInline.tsx'
assert.ok(existsSync(join(root, inlinePath)), 'inline plugin detail settings component must exist')
const inlineSettings = read(inlinePath)
assert.match(inlineSettings, /contribution\.migrate/, 'inline plugin detail settings must run settings migrations just like the dialog')
assert.doesNotMatch(inlineSettings, /storedVersion\s*!==\s*currentVersion\)\s*return contribution\.defaultValue/, 'inline plugin detail settings must not silently reset versioned settings')

assert.match(files.webOpen, /schema:\s*\{/, 'at least one bundled plugin should exercise host-rendered settings schema')
assert.match(files.webOpen, /kind:\s*['"]object-list['"]/, 'web quick open should use schema object-list UI for entries')
assert.match(files.webOpen, /key:\s*['"]urlTemplate['"]/, 'web quick open schema should expose URL template editing')
assert.match(files.webOpen, /kind:\s*['"]string-list['"]/, 'web quick open schema should expose alias editing as a list UI')
assert.match(files.webOpen, /key:\s*['"]urlTemplate['"][\s\S]{0,520}mono:\s*true/, 'web quick open URL templates should explicitly render as mono fields')
assert.match(files.webOpen, /添加规则/, 'web quick open schema should use the designed add-rule copy')
assert.match(files.webOpen, /触发词/, 'web quick open schema should name aliases as trigger words')
assert.match(files.webOpen, /地址模板/, 'web quick open schema should present URL templates as address templates')
assert.doesNotMatch(files.webOpen, /JSON.stringify|JSON.parse|Entries JSON|条目 JSON/, 'web quick open settings must not fall back to JSON editing')
assert.doesNotMatch(files.webOpen, /settings:\s*\{[\s\S]{0,260}component:/, 'schema-first bundled plugins should not need a legacy settings component')

assert.match(files.clipboardHistory, /schema:\s*\{/, 'clipboard history settings should be schema-rendered')
assert.match(files.clipboardHistory, /storageScale:\s*MB/, 'clipboard history byte limits should render as MB-backed number fields')
assert.doesNotMatch(files.clipboardHistory, /ClipboardHistorySettingsBody/, 'clipboard history settings should be fully schema-based')

console.log('plugin settings schema checks passed')
