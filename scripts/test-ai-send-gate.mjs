import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const gate = await vite.ssrLoadModule('/src/workspace/ai/sendGate.ts')
  const key = gate.aiSendGrantKey('builtin-plugin', 'explain')
  let grants = gate.addAiSendGrant([], { key, label: 'Explain with AI' })
  grants = gate.addAiSendGrant(grants, { key, label: 'Explain with AI' })
  assert.equal(grants.length, 1, 'a command is granted once')
  const plain = { text: 'before', extras: ['after'] }
  assert.deepEqual(gate.decideAiSend(plain, false), { confirm: true, secret: false })
  assert.deepEqual(gate.decideAiSend(plain, grants.some(g => g.key === key)), { confirm: false, secret: false }, 'a grant skips the confirmation')
  assert.deepEqual(gate.decideAiSend({ ...plain, consent: 'implicit' }, false), { confirm: false, secret: false })
  const secret = { text: 'deploy', extras: ['sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'] }
  assert.deepEqual(gate.decideAiSend(secret, true), { confirm: true, secret: true }, 'secrets ignore grants')
  assert.deepEqual(gate.decideAiSend({ ...secret, consent: 'implicit' }, true), { confirm: true, secret: true }, 'secrets ignore implicit consent')
  assert.equal(gate.removeAiSendGrant(grants, key).length, 0, 'revoking restores the confirmation')
  console.log('AiSendGate passed: grant once, grant skips confirm, secrets always confirm, revoke')
} finally {
  await vite.close()
}
