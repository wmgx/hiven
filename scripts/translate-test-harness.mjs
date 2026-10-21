import { load } from './ai-runtime-test-harness.mjs'

export const glossary = load('src/plugins/translate/ai/glossary.ts', {}, { TextEncoder })
export const prompt = load('src/plugins/translate/ai/prompt.ts', { './glossary': glossary })
export const errors = load('src/plugins/translate/providers/errors.ts', {})
export const adapters = load('src/plugins/translate/providers/adapters.ts', {
  './tencent': {},
  './errors': errors,
  '../ai/prompt': prompt,
}, { TextEncoder, URLSearchParams })
