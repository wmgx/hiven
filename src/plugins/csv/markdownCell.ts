/**
 * Encode source text as literal GFM table-cell content.
 * Source HTML/entities and Markdown syntax cannot become markup; only line breaks
 * generated here are HTML. Encode backslashes before pipes to avoid escape parity.
 */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\|`*_\[\]~!]/g, (character) => `&#${character.charCodeAt(0)};`)
    .replace(/\r\n|\r|\n/g, '<br>')
}
