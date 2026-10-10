/// One launcher window session. Native close/reopen invalidates commands already
/// in flight; revisions order frontend requests within that session.
pub(crate) struct LauncherResizeState {
    pub session: u64,
    pub revision: u64,
    active: bool,
}

impl Default for LauncherResizeState {
    fn default() -> Self {
        Self { session: 1, revision: 0, active: false }
    }
}

impl LauncherResizeState {
    pub fn reset(&mut self, active: bool) {
        self.session += 1;
        self.revision = 0;
        self.active = active;
    }

    pub fn accept(&mut self, session: u64, revision: u64) -> bool {
        if !self.active || session != self.session || revision <= self.revision {
            return false;
        }
        self.revision = revision;
        true
    }
}

/// Work-area limits are logical pixels from the launcher's current monitor.
/// A too-large plugin minimum must never make its window impossible to fit.
pub(crate) fn fit_dimension(desired: f64, minimum: f64, available: f64) -> f64 {
    desired.max(minimum.min(available)).min(available)
}

pub(crate) fn fallback_dimension(current: f64, compact: f64) -> f64 {
    if current.is_finite() && current > 0.0 { current } else { compact }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_old_surface_requests_and_closed_sessions() {
        let mut state = LauncherResizeState::default();
        assert!(!state.accept(1, 1));
        state.reset(true);
        assert!(state.accept(2, 2));
        assert!(!state.accept(2, 1));
        assert!(!state.accept(2, 2));
        state.reset(false);
        assert!(!state.accept(2, 100));
        assert!(!state.accept(3, 1));
        state.reset(true);
        assert!(!state.accept(3, 100));
        assert!(state.accept(4, 1));
    }

    #[test]
    fn defaults_and_minimums_fit_the_monitor_work_area() {
        assert_eq!(fit_dimension(744.0, 544.0, 1200.0), 744.0);
        assert_eq!(fit_dimension(400.0, 544.0, 1200.0), 544.0);
        assert_eq!(fit_dimension(1600.0, 544.0, 1200.0), 1200.0);
        assert_eq!(fit_dimension(744.0, 900.0, 700.0), 700.0);
        assert_eq!(fit_dimension(1e100, 1e100, fallback_dimension(744.0, 660.0)), 744.0);
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(fallback_dimension(invalid, 660.0), 660.0);
        }
    }
}
