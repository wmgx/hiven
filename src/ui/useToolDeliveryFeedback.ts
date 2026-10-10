import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createToolDeliveryFeedbackController, type ToolDeliveryFeedbackOwner } from './toolDeliveryFeedback'

/**
 * Keep feedback with the mounted tool, current host owner and current result.
 * Call invalidate synchronously before changing input/options or requesting exit.
 * Call beginAttempt before any delivery, and check its isCurrent before I/O and
 * after awaiting it. Existing delivery locks and host completion stay with callers.
 */
export function useToolDeliveryFeedback(resultIdentity: unknown, owner?: ToolDeliveryFeedbackOwner) {
  const [controller] = useState(createToolDeliveryFeedbackController)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)

  useLayoutEffect(() => {
    controller.activate()
    return () => controller.deactivate()
  }, [controller])

  useLayoutEffect(() => {
    controller.setContext(resultIdentity, owner)
  }, [controller, resultIdentity, owner])

  useLayoutEffect(() => {
    if (!owner) return
    const stop = owner.subscribeInvalidation(controller.invalidate)
    // An owner may have expired between render and subscription.
    if (!owner.isCurrent()) controller.invalidate()
    return stop
  }, [controller, owner])

  const beginAttempt = useCallback(
    () => controller.beginAttempt(resultIdentity, owner, snapshot.revision),
    [controller, resultIdentity, owner, snapshot.revision],
  )

  return {
    feedback: controller.matches(resultIdentity, owner) ? snapshot.feedback : null,
    beginAttempt,
    invalidate: controller.invalidate,
  }
}
