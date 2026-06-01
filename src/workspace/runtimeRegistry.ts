/**
 * FluxText Workspace Extension - Runtime Registry
 * Holds Monaco instances, disposables, decoration owners, etc.
 * These are NOT persisted - they are recreated on mount.
 */

import type { PaneId } from './types'

export interface Disposable {
  dispose(): void
}

class RuntimeRegistryImpl {
  codeEditors: Map<PaneId, any> = new Map() // monaco.editor.ICodeEditor
  diffEditors: Map<string, any> = new Map() // monaco.editor.IStandaloneDiffEditor
  disposables: Map<string, Disposable[]> = new Map()
  decorationOwners: Map<string, string[]> = new Map() // paneId -> owner decoration ids
  viewZoneOwners: Map<string, string[]> = new Map()
  widgetOwners: Map<string, string[]> = new Map()

  registerCodeEditor(paneId: PaneId, editor: any) {
    this.codeEditors.set(paneId, editor)
  }

  unregisterCodeEditor(paneId: PaneId) {
    this.codeEditors.delete(paneId)
  }

  getCodeEditor(paneId: PaneId): any | null {
    return this.codeEditors.get(paneId) ?? null
  }

  registerDiffEditor(sessionId: string, editor: any) {
    this.diffEditors.set(sessionId, editor)
  }

  unregisterDiffEditor(sessionId: string) {
    this.diffEditors.delete(sessionId)
  }

  getDiffEditor(sessionId: string): any | null {
    return this.diffEditors.get(sessionId) ?? null
  }

  addDisposable(ownerId: string, disposable: Disposable) {
    const list = this.disposables.get(ownerId) || []
    list.push(disposable)
    this.disposables.set(ownerId, list)
  }

  disposeOwner(ownerId: string) {
    const list = this.disposables.get(ownerId)
    if (list) {
      for (const d of list) {
        try { d.dispose() } catch {}
      }
      this.disposables.delete(ownerId)
    }
    this.decorationOwners.delete(ownerId)
    this.viewZoneOwners.delete(ownerId)
    this.widgetOwners.delete(ownerId)
  }

  disposeAll() {
    for (const [ownerId] of this.disposables) {
      this.disposeOwner(ownerId)
    }
    this.codeEditors.clear()
    this.diffEditors.clear()
  }
}

export const runtimeRegistry = new RuntimeRegistryImpl()
