import { markdownPlainText } from './markdownPlainText'
self.onmessage = (event: MessageEvent<{ text: string; imageLabel: string }>) => {
  try { self.postMessage({ status: 'ready', text: markdownPlainText(event.data.text, event.data.imageLabel) }) }
  catch (error) { self.postMessage({ status: 'error', messageKey: error instanceof Error && error.message === 'limit' ? 'markdownPlain.limit' : 'markdownPlain.failed' }) }
}
