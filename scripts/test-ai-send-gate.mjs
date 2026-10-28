import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const gate = await vite.ssrLoadModule('/src/workspace/ai/sendGate.ts')
  const plain = { text: 'before', extras: ['after'] }
  assert.deepEqual(gate.decideAiSend(plain), { allowed: true, secret: false })
  assert.equal(gate.aiSendCharCount(plain), 11)
  const secret = { text: 'deploy', extras: ['sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'] }
  assert.deepEqual(gate.decideAiSend(secret), { allowed: false, secret: true }, 'secrets in any material are blocked')
  console.log('AiSendGate passed: visible material, count, secrets blocked')
} finally {
  await vite.close()
}
