//! Provider-independent native request cancellation. No credentials or provider state.

use std::collections::HashMap;
use std::future::{poll_fn, Future};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::Poll;
use std::time::{Duration, Instant};
use tokio::sync::watch;

const MAX_PENDING_CANCELLATIONS: usize = 256;
const PENDING_CANCELLATION_TTL: Duration = Duration::from_secs(60);
const MAX_RUN_ID_BYTES: usize = 128;

#[derive(Default)]
struct RegistryState {
    active: HashMap<String, Arc<watch::Sender<bool>>>,
    pending: HashMap<String, Instant>,
}

/// A bounded grace period for cancel IPC arriving before stream IPC registers.
#[derive(Default)]
pub(crate) struct RunRegistry {
    state: Mutex<RegistryState>,
}

impl RunRegistry {
    #[cfg(test)]
    pub(crate) fn is_idle(&self) -> bool {
        self.state().active.is_empty()
    }

    fn state(&self) -> MutexGuard<'_, RegistryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn register(&self, run_id: &str) -> Result<RunGuard<'_>, String> {
        if run_id.is_empty() || run_id.len() > MAX_RUN_ID_BYTES {
            return Err("xAI run ID is invalid".to_string());
        }
        let mut state = self.state();
        if state.active.contains_key(run_id) {
            return Err("xAI run ID is already active".to_string());
        }
        let now = Instant::now();
        state
            .pending
            .retain(|_, at| now.duration_since(*at) < PENDING_CANCELLATION_TTL);
        let cancelled = state.pending.remove(run_id).is_some();
        let (sender, _) = watch::channel(cancelled);
        let cancellation = Arc::new(sender);
        state.active.insert(run_id.to_owned(), cancellation.clone());
        Ok(RunGuard {
            registry: self,
            run_id: run_id.to_owned(),
            cancellation,
        })
    }

    pub(crate) fn cancel(&self, run_id: &str) {
        if run_id.is_empty() || run_id.len() > MAX_RUN_ID_BYTES {
            return;
        }
        let mut state = self.state();
        if let Some(cancellation) = state.active.get(run_id) {
            cancellation.send_replace(true);
            return;
        }
        let now = Instant::now();
        state
            .pending
            .retain(|_, at| now.duration_since(*at) < PENDING_CANCELLATION_TTL);
        if state.pending.len() >= MAX_PENDING_CANCELLATIONS && !state.pending.contains_key(run_id) {
            if let Some(oldest) = state
                .pending
                .iter()
                .min_by_key(|(_, at)| **at)
                .map(|(id, _)| id.clone())
            {
                state.pending.remove(&oldest);
            }
        }
        state.pending.insert(run_id.to_owned(), now);
    }
}

pub(crate) struct RunGuard<'a> {
    registry: &'a RunRegistry,
    run_id: String,
    cancellation: Arc<watch::Sender<bool>>,
}

impl RunGuard<'_> {
    /// Dropping the losing future releases a pending HTTP send/read immediately.
    /// A watch value also catches cancellation before the first poll (no lost wake).
    pub(crate) async fn until_cancelled<F: Future>(&self, future: F) -> Option<F::Output> {
        let mut receiver = self.cancellation.subscribe();
        let mut cancelled = Box::pin(async move {
            while !*receiver.borrow_and_update() {
                if receiver.changed().await.is_err() {
                    break;
                }
            }
        });
        let mut future = Box::pin(future);
        poll_fn(|cx| {
            if cancelled.as_mut().poll(cx).is_ready() {
                return Poll::Ready(None);
            }
            future.as_mut().poll(cx).map(Some)
        })
        .await
    }
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.registry.state();
        if state
            .active
            .get(&self.run_id)
            .is_some_and(|active| Arc::ptr_eq(active, &self.cancellation))
        {
            state.active.remove(&self.run_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn early_cancel_is_consumed_once_and_does_not_poll_work() {
        runtime().block_on(async {
            let registry = RunRegistry::default();
            registry.cancel("early");
            let run = registry.register("early").unwrap();
            assert_eq!(
                run.until_cancelled(async { panic!("cancelled request must not start") })
                    .await,
                None::<()>
            );
            drop(run);
            assert!(registry.state().active.is_empty());
            assert!(registry.state().pending.is_empty());
            let next = registry.register("early").unwrap();
            assert_eq!(next.until_cancelled(async { 7 }).await, Some(7));
        });
    }

    #[test]
    fn pending_cancel_gate_expires_and_evicts_at_its_bound() {
        let registry = RunRegistry::default();
        for invalid_id in [String::new(), "x".repeat(MAX_RUN_ID_BYTES + 1)] {
            registry.cancel(&invalid_id);
            assert!(registry.register(&invalid_id).is_err());
        }
        assert!(registry.state().pending.is_empty());
        registry.state().pending.insert(
            "expired".to_owned(),
            Instant::now() - PENDING_CANCELLATION_TTL - Duration::from_secs(1),
        );
        let expired = registry.register("expired").unwrap();
        assert!(!*expired.cancellation.borrow());
        for index in 0..(MAX_PENDING_CANCELLATIONS * 2) {
            registry.cancel(&format!("pending-{}", index));
        }
        assert_eq!(registry.state().pending.len(), MAX_PENDING_CANCELLATIONS);
        assert!(!registry.state().pending.contains_key("pending-0"));
        assert!(registry
            .state()
            .pending
            .contains_key(&format!("pending-{}", MAX_PENDING_CANCELLATIONS * 2 - 1)));
    }

    #[test]
    fn duplicate_run_cannot_replace_or_clean_up_original_registration() {
        let registry = RunRegistry::default();
        let original = registry.register("same").unwrap();
        assert!(registry.register("same").is_err());
        assert_eq!(registry.state().active.len(), 1);
        registry.cancel("same");
        assert!(*original.cancellation.borrow());
        drop(original);
        assert!(registry.state().active.is_empty());
    }

    #[test]
    fn registry_cleans_up_on_error_and_dropped_command_future() {
        runtime().block_on(async {
            let registry = Arc::new(RunRegistry::default());
            {
                let run = registry.register("error").unwrap();
                assert_eq!(
                    run.until_cancelled(async { Err::<(), _>("fixture error") })
                        .await,
                    Some(Err("fixture error"))
                );
            }
            assert!(registry.state().active.is_empty());
            let (started_tx, started_rx) = oneshot::channel();
            let worker_registry = registry.clone();
            let task = tokio::spawn(async move {
                let run = worker_registry.register("dropped").unwrap();
                let _ = started_tx.send(());
                run.until_cancelled(std::future::pending::<()>()).await
            });
            started_rx.await.unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert!(registry.state().active.is_empty());
        });
    }
}
