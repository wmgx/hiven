import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuickEditorStore, QuickEditorState } from './quickEditorTypes'

const INITIAL_STATE: QuickEditorState = {
  text: '',
  language: 'plaintext',
  languageSource: 'auto',
  cursorPosition: { lineNumber: 1, column: 1 },
  scrollPosition: { scrollTop: 0, scrollLeft: 0 },
}

export const useQuickEditorStore = create<QuickEditorStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setText: (text) => set({ text }),
      setLanguage: (language) => set({ language, languageSource: 'manual' }),
      setDetectedLanguage: (language) => set({ language, languageSource: 'auto' }),
      setCursorPosition: (cursorPosition) => set({ cursorPosition }),
      setScrollPosition: (scrollPosition) => set({ scrollPosition }),
      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'hiven-quick-editor',
      partialize: (state) => ({
        text: state.text,
        language: state.language,
        languageSource: state.languageSource,
        cursorPosition: state.cursorPosition,
        scrollPosition: state.scrollPosition,
      }),
    }
  )
)
