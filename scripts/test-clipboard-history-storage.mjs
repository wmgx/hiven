#!/usr/bin/env node
// Keep the established npm entrypoint; exercise production v2 storage rather
// than a second, handwritten model of the retired count/day-based repository.
await import('./test-clipboard-history-paged.mjs')
