/**
 * FluxText - Register built-in panels
 * Import this module at app startup to register all built-in panels.
 */

import { panelRegistry } from '../workspace/panelRegistry'
import { RegexTesterPanel } from './RegexTesterPanel'

// Register Regex Tester panel
panelRegistry.register({
  id: 'regex-tester',
  title: 'Regex Tester',
  defaultPlacement: 'bottom',
  defaultScope: 'workspace',
  component: RegexTesterPanel,
})
