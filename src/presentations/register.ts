/**
 * FluxText - Register built-in presentation renderers
 * Import this module at app startup to register all built-in renderers.
 */

import { presentationRegistry } from '../workspace/presentationRegistry'
import { MonacoDiffRenderer } from './monacoDiffRenderer'
import { JsonObjectDiffRenderer } from './jsonObjectDiffRenderer'

// Register Monaco Diff renderer
presentationRegistry.register({
  id: 'monaco-diff',
  title: 'Monaco Diff',
  supportedInputCounts: [2],
  supportedRoles: ['original', 'modified'],
  supportedModes: ['side-by-side', 'inline'],
  component: MonacoDiffRenderer,
})

// Register JSON Object Diff renderer
presentationRegistry.register({
  id: 'json-object-diff',
  title: 'JSON Object Diff',
  supportedInputCounts: [2],
  supportedRoles: ['original', 'modified'],
  supportedModes: ['side-by-side', 'inline', 'summary'],
  component: JsonObjectDiffRenderer,
})
