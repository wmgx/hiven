export type InvisibleCharacterCleanup = {
  text: string
  normalizedSpaces: number
  removedCharacters: number
}

/**
 * Normalize only the copy artifacts named by this explicit operation.
 * Other formatting controls, including ZWNJ/ZWJ and bidi controls, are data.
 */
export function cleanInvisibleCharacters(text: string): InvisibleCharacterCleanup {
  let normalizedSpaces = 0
  let removedCharacters = 0
  let output = ''
  let unchangedStart = 0

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    const normalizeSpace = code === 0x00a0 || code === 0x202f
    const removeCharacter = code === 0x00ad || code === 0x200b
    if (!normalizeSpace && !removeCharacter) continue

    output += text.slice(unchangedStart, index)
    if (normalizeSpace) {
      output += ' '
      normalizedSpaces++
    } else {
      removedCharacters++
    }
    unchangedStart = index + 1
  }

  if (normalizedSpaces === 0 && removedCharacters === 0) {
    return { text, normalizedSpaces, removedCharacters }
  }
  return {
    text: output + text.slice(unchangedStart),
    normalizedSpaces,
    removedCharacters,
  }
}
