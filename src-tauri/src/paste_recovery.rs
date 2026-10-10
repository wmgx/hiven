//! Ownership of one user-initiated paste, independent of any target window.
//! The registry lock is only held for state changes, never for OS calls or waits.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub(crate) const CANCELLED: &str = "HIVEN_PASTE_ATTEMPT_CANCELLED";

pub(crate) fn cancelled_error() -> String {
    format!("{CANCELLED}: paste attempt was cancelled or superseded")
}

#[derive(Debug)]
pub(crate) struct Attempt {
    pub(crate) id: String,
    pub(crate) label: String,
    instance: u64,
    pub(crate) destroy_timeout_ms: Option<u64>,
    cancelled: AtomicBool,
    expected_blur: AtomicBool,
    started: AtomicBool,
    hidden: AtomicBool,
    handoff: AtomicBool,
}

impl Attempt {
    pub(crate) fn claim(&self) -> Result<(), String> {
        self.ensure_active()?;
        if self.started.swap(true, Ordering::SeqCst) {
            Err("Paste attempt has already started".into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn ensure_active(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err(cancelled_error())
        } else {
            Ok(())
        }
    }

    pub(crate) fn was_hidden(&self) -> bool {
        self.hidden.load(Ordering::SeqCst)
    }

    pub(crate) fn mark_hidden(&self) {
        self.hidden.store(true, Ordering::SeqCst);
    }

    pub(crate) fn mark_handoff(&self) {
        self.handoff.store(true, Ordering::SeqCst);
    }

    pub(crate) fn needs_recovery(&self) -> bool {
        self.handoff.load(Ordering::SeqCst) && self.ensure_active().is_ok()
    }

    pub(crate) fn disarm_blur(&self) {
        self.expected_blur.store(false, Ordering::SeqCst);
    }

    pub(crate) fn expected_blur_pending(&self) -> bool {
        self.expected_blur.load(Ordering::SeqCst)
    }
}

struct WindowInstance {
    generation: u64,
    destroy_timeout_ms: Option<u64>,
}

#[derive(Default)]
struct Registry {
    sequence: u64,
    windows: HashMap<String, WindowInstance>,
    active: Option<Arc<Attempt>>,
}

impl Registry {
    fn next(&mut self) -> u64 {
        self.sequence = self.sequence.checked_add(1).expect("paste owner exhausted");
        self.sequence
    }

    fn cancel_all(&mut self) {
        if let Some(attempt) = self.active.take() {
            attempt.cancelled.store(true, Ordering::SeqCst);
        }
    }

    fn cancel(&mut self, label: &str, id: &str) {
        if self.current(label, id).is_some() {
            self.cancel_all();
        }
    }

    fn register_window(&mut self, label: &str, destroy_timeout_ms: Option<u64>) -> u64 {
        self.invalidate_window(label, None);
        let instance = self.next();
        self.windows.insert(
            label.to_string(),
            WindowInstance {
                generation: instance,
                destroy_timeout_ms,
            },
        );
        instance
    }

    fn begin(&mut self, label: &str) -> Option<Arc<Attempt>> {
        let window = self.windows.get(label)?;
        let instance = window.generation;
        let destroy_timeout_ms = window.destroy_timeout_ms;
        // Clipboard ownership is process-wide: a newer operation supersedes
        // the older one even when it starts in another hiven surface.
        self.cancel_all();
        let attempt = Arc::new(Attempt {
            id: self.next().to_string(),
            label: label.to_string(),
            instance,
            destroy_timeout_ms,
            cancelled: AtomicBool::new(false),
            expected_blur: AtomicBool::new(false),
            started: AtomicBool::new(false),
            hidden: AtomicBool::new(false),
            handoff: AtomicBool::new(false),
        });
        self.active = Some(attempt.clone());
        Some(attempt)
    }

    fn current(&self, label: &str, id: &str) -> Option<Arc<Attempt>> {
        self.active
            .as_ref()
            .filter(|attempt| {
                attempt.label == label
                    && attempt.id == id
                    && self.is_window_current(label, attempt.instance)
                    && attempt.ensure_active().is_ok()
            })
            .cloned()
    }

    fn invalidate_window(&mut self, label: &str, instance: Option<u64>) {
        if self.active.as_ref().is_some_and(|attempt| {
            attempt.label == label && instance.map_or(true, |value| value == attempt.instance)
        }) {
            self.cancel_all();
        }
    }

    fn is_window_current(&self, label: &str, instance: u64) -> bool {
        self.windows.get(label).is_some_and(|window| window.generation == instance)
    }

    fn destroyed(&mut self, label: &str, instance: u64) -> bool {
        self.invalidate_window(label, Some(instance));
        if self.is_window_current(label, instance) {
            self.windows.remove(label);
            return true;
        }
        false
    }

    fn consume_blur(&self, label: &str, instance: u64) -> bool {
        self.active.as_ref().is_some_and(|attempt| {
            attempt.label == label
                && attempt.instance == instance
                && attempt.ensure_active().is_ok()
                && attempt.expected_blur.swap(false, Ordering::SeqCst)
        })
    }
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

pub(crate) fn register_window(label: &str, destroy_timeout_ms: Option<u64>) -> u64 {
    registry().lock().unwrap().register_window(label, destroy_timeout_ms)
}

pub(crate) fn begin(label: &str) -> Option<Arc<Attempt>> {
    registry().lock().ok()?.begin(label)
}

pub(crate) fn current(label: &str, id: &str) -> Result<Arc<Attempt>, String> {
    registry()
        .lock()
        .ok()
        .and_then(|state| state.current(label, id))
        .ok_or_else(cancelled_error)
}

pub(crate) fn arm(attempt: &Attempt, expects_blur: bool) -> Result<(), String> {
    let state = registry().lock().map_err(|_| "Paste owner lock poisoned")?;
    state
        .current(&attempt.label, &attempt.id)
        .ok_or_else(cancelled_error)?;
    attempt.expected_blur.store(expects_blur, Ordering::SeqCst);
    Ok(())
}

pub(crate) fn cancel(label: &str, id: &str) {
    if let Ok(mut state) = registry().lock() {
        state.cancel(label, id);
    }
}

pub(crate) fn invalidate_all() {
    if let Ok(mut state) = registry().lock() {
        state.cancel_all();
    }
}

pub(crate) fn invalidate_window(label: &str, instance: Option<u64>) {
    if let Ok(mut state) = registry().lock() {
        state.invalidate_window(label, instance);
    }
}

pub(crate) fn destroyed(label: &str, instance: u64) -> bool {
    registry().lock().is_ok_and(|mut state| state.destroyed(label, instance))
}

pub(crate) fn is_window_current(label: &str, instance: u64) -> bool {
    registry().lock().is_ok_and(|state| state.is_window_current(label, instance))
}

pub(crate) fn window_instance(label: &str) -> Option<u64> {
    registry().lock().ok()?.windows.get(label).map(|window| window.generation)
}

pub(crate) fn consume_blur(label: &str, instance: u64) -> bool {
    registry().lock().is_ok_and(|state| state.consume_blur(label, instance))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registered() -> (Registry, u64) {
        let mut state = Registry::default();
        let instance = state.register_window("launcher", None);
        (state, instance)
    }

    #[test]
    fn cancellation_before_hide_cannot_register_it_again() {
        let (mut state, _) = registered();
        let old = state.begin("launcher").unwrap();
        state.cancel_all();
        assert!(old.ensure_active().is_err());
        assert!(state.current("launcher", &old.id).is_none());
    }

    #[test]
    fn newer_operation_owns_clipboard_across_surfaces() {
        let (mut state, _) = registered();
        state.register_window("history", Some(30 * 60 * 1000));
        let old = state.begin("launcher").unwrap();
        let new = state.begin("history").unwrap();
        assert!(old.ensure_active().is_err());
        assert!(state.current("history", &new.id).is_some());
        assert_eq!(new.destroy_timeout_ms, Some(30 * 60 * 1000));
        // A delayed old cancellation cannot cancel the new owner.
        assert!(state.current("launcher", &old.id).is_none());
        state.cancel("launcher", &old.id);
        assert!(state.current("history", &new.id).is_some());
    }

    #[test]
    fn destroyed_instance_cannot_recover_a_recreated_same_label() {
        let (mut state, first_instance) = registered();
        let old = state.begin("launcher").unwrap();
        state.destroyed("launcher", first_instance);
        let second_instance = state.register_window("launcher", None);
        let new = state.begin("launcher").unwrap();
        assert_ne!(first_instance, second_instance);
        assert!(state.current("launcher", &old.id).is_none());
        // A late event from the dead window must not affect its replacement.
        state.destroyed("launcher", first_instance);
        assert!(state.current("launcher", &new.id).is_some());
    }

    #[test]
    fn only_one_armed_blur_is_expected() {
        let (mut state, instance) = registered();
        let attempt = state.begin("launcher").unwrap();
        assert!(!state.consume_blur("launcher", instance));
        attempt.expected_blur.store(true, Ordering::SeqCst);
        assert!(!state.consume_blur("other", instance));
        assert!(!state.consume_blur("launcher", instance + 1));
        assert!(state.consume_blur("launcher", instance));
        assert!(!state.consume_blur("launcher", instance));
    }

    #[test]
    fn real_close_cancels_an_armed_attempt() {
        let (mut state, instance) = registered();
        let attempt = state.begin("launcher").unwrap();
        attempt.expected_blur.store(true, Ordering::SeqCst);
        state.invalidate_window("launcher", Some(instance));
        assert!(!state.consume_blur("launcher", instance));
        assert!(attempt.ensure_active().is_err());
    }

    #[test]
    fn duplicate_invocation_cannot_claim_or_cancel_the_running_delivery() {
        let (mut state, _) = registered();
        let attempt = state.begin("launcher").unwrap();
        assert!(attempt.claim().is_ok());
        assert!(attempt.claim().is_err());
        assert!(state.current("launcher", &attempt.id).is_some());
    }

    #[test]
    fn failure_recovers_only_after_handoff_and_while_current() {
        let (mut state, _) = registered();
        let attempt = state.begin("launcher").unwrap();
        assert!(!attempt.needs_recovery());
        attempt.claim().unwrap();
        attempt.mark_handoff();
        // keepOpen still needs focus recovery, without changing visibility.
        assert!(attempt.needs_recovery());
        assert!(!attempt.was_hidden());
        attempt.mark_hidden();
        assert!(attempt.was_hidden());
        state.cancel_all();
        assert!(!attempt.needs_recovery());
    }

    #[test]
    fn completing_or_recovering_cannot_leave_an_expected_blur() {
        let (mut state, instance) = registered();
        let attempt = state.begin("launcher").unwrap();
        attempt.expected_blur.store(true, Ordering::SeqCst);
        attempt.disarm_blur();
        assert!(!state.consume_blur("launcher", instance));
        state.cancel("launcher", &attempt.id);
        assert!(state.active.is_none());
        assert!(!attempt.needs_recovery());
    }

    #[test]
    fn reopening_same_window_revokes_late_hide_and_failure_recovery() {
        let (mut state, instance) = registered();
        let old = state.begin("launcher").unwrap();
        old.mark_handoff();
        old.mark_hidden();
        state.cancel_all();
        assert!(state.is_window_current("launcher", instance));
        assert!(old.claim().is_err());
        assert!(!old.needs_recovery());
        let new = state.begin("launcher").unwrap();
        state.cancel("launcher", &old.id);
        assert!(state.current("launcher", &new.id).is_some());
    }
}
