import { useLayoutEffect, useState } from 'react'
import InlineMarkdownWorker from './markdownPlain.worker?worker&inline'
import { checkMarkdownInput } from './markdownPlainText'
import type { WorkbenchResult } from './workbenchModel'

const IDLE: WorkbenchResult = { status: 'idle' }
const PROCESSING: WorkbenchResult = { status: 'processing' }

/** An input/revision-bound result; stale worker messages cannot enable delivery. */
export function useMarkdownPlainText(text: string, enabled: boolean, revision: number, imageLabel: string): WorkbenchResult {
  const [completed, setCompleted] = useState<{ text: string; revision: number; imageLabel: string; result: WorkbenchResult } | null>(null)
  useLayoutEffect(() => {
    if (!enabled || !text.length) return
    let live = true
    let worker: Worker | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const stop = () => { worker?.terminate(); if (timeout !== undefined) clearTimeout(timeout) }
    const finish = (result: WorkbenchResult) => {
      if (!live) return
      live = false; stop(); setCompleted({ text, revision, imageLabel, result })
    }
    try {
      checkMarkdownInput(text)
      worker = new InlineMarkdownWorker()
      worker.onmessage = event => {
        const result = event.data
        if (result?.status === 'ready' && typeof result.text === 'string') finish(result)
        else finish({ status: 'error', messageKey: result?.messageKey === 'markdownPlain.limit' ? 'markdownPlain.limit' : 'markdownPlain.failed' })
      }
      worker.onerror = event => { event.preventDefault(); finish({ status: 'error', messageKey: 'markdownPlain.failed' }) }
      worker.onmessageerror = () => finish({ status: 'error', messageKey: 'markdownPlain.failed' })
      timeout = setTimeout(() => finish({ status: 'error', messageKey: 'markdownPlain.timeout' }), 1000)
      worker.postMessage({ text, imageLabel })
    } catch (error) { finish({ status: 'error', messageKey: error instanceof Error && error.message === 'limit' ? 'markdownPlain.limit' : 'markdownPlain.failed' }) }
    return () => { live = false; stop() }
  }, [text, enabled, revision, imageLabel])
  if (!enabled || !text.length) return IDLE
  return completed?.text === text && completed.revision === revision && completed.imageLabel === imageLabel
    ? completed.result : PROCESSING
}
