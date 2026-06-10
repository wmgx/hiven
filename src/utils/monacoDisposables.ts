export interface MonacoDisposable {
  dispose(): void
}

export function disposeAllMonacoDisposables(disposables: MonacoDisposable[]) {
  while (disposables.length > 0) {
    const disposable = disposables.pop()
    try {
      disposable?.dispose()
    } catch {
      // Best-effort cleanup; a broken disposable should not block the rest.
    }
  }
}

export function createMonacoDisposableBucket() {
  const disposables: MonacoDisposable[] = []
  let disposed = false

  return {
    add<T extends MonacoDisposable>(disposable: T): T {
      if (disposed) {
        try {
          disposable.dispose()
        } catch {
          // Keep cleanup best-effort for late subscriptions during teardown.
        }
        return disposable
      }
      disposables.push(disposable)
      return disposable
    },
    dispose() {
      disposed = true
      disposeAllMonacoDisposables(disposables)
    },
  }
}
