import InlineMarkdownWorker from './markdownPlain.worker?worker&inline'
import { checkMarkdownInput } from './markdownPlainText'

export function runMarkdownPlain(text: string, imageLabel: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (output?: string, error?: string) => {
      worker?.terminate()
      clearTimeout(timeout)
      if (error) reject(new Error(error))
      else resolve(output ?? '')
    }
    try {
      checkMarkdownInput(text)
      worker = new InlineMarkdownWorker()
      worker.onmessage = ({ data }) => data?.status === 'ready' && typeof data.text === 'string'
        ? finish(data.text)
        : finish(undefined, data?.messageKey === 'markdownPlain.limit' ? 'markdownPlain.limit' : 'markdownPlain.failed')
      worker.onerror = event => { event.preventDefault(); finish(undefined, 'markdownPlain.failed') }
      worker.onmessageerror = () => finish(undefined, 'markdownPlain.failed')
      timeout = setTimeout(() => finish(undefined, 'markdownPlain.timeout'), 1000)
      worker.postMessage({ text, imageLabel })
    } catch (error) {
      finish(undefined, error instanceof Error && error.message === 'limit' ? 'markdownPlain.limit' : 'markdownPlain.failed')
    }
  })
}
