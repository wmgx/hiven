use std::sync::atomic::{AtomicU8, Ordering};

const STOPPED: u8 = 0;
const STARTING: u8 = 1;
const RUNNING: u8 = 2;

/// The lease owns one server attempt, including the period before its thread starts.
#[derive(Default)]
pub(super) struct ServerLifecycle {
    phase: AtomicU8,
}

impl ServerLifecycle {
    pub(super) fn try_start(&self) -> Option<ServerLease<'_>> {
        self.phase
            .compare_exchange(STOPPED, STARTING, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| ServerLease { state: self })
    }

    pub(super) fn running(&self) -> bool {
        self.phase.load(Ordering::Acquire) == RUNNING
    }
}

pub(super) struct ServerLease<'a> {
    state: &'a ServerLifecycle,
}

impl ServerLease<'_> {
    /// Call only after the socket is bound and ready to accept connections.
    pub(super) fn listening(&self) {
        self.state.phase.store(RUNNING, Ordering::Release);
    }
}

impl Drop for ServerLease<'_> {
    fn drop(&mut self) {
        self.state.phase.store(STOPPED, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn failed_attempt_can_restart_and_running_requires_listener() {
        let state = ServerLifecycle::default();
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = occupied.local_addr().unwrap();
        {
            let _lease = state.try_start().unwrap();
            assert!(!state.running());
            assert!(state.try_start().is_none());
            assert!(TcpListener::bind(address).is_err());
        }
        assert!(!state.running());
        drop(occupied);
        {
            let lease = state.try_start().unwrap();
            let _listener = TcpListener::bind(address).unwrap();
            lease.listening();
            assert!(state.running());
            assert!(state.try_start().is_none());
        }
        assert!(!state.running());
        assert!(state.try_start().is_some());
    }

    #[test]
    fn unstarted_thread_closure_and_unwind_release_attempt() {
        let state = ServerLifecycle::default();
        let lease = state.try_start().unwrap();
        // Thread spawn failure drops the closure without invoking it.
        let not_spawned = move || {
            lease.listening();
        };
        drop(not_spawned);
        assert!(!state.running());
        let result = std::panic::catch_unwind(|| {
            let lease = state.try_start().unwrap();
            lease.listening();
            panic!("synthetic server exit");
        });
        assert!(result.is_err());
        assert!(!state.running());
        assert!(state.try_start().is_some());
    }

    #[test]
    fn concurrent_attempts_have_one_owner_until_release() {
        use std::sync::{atomic::AtomicUsize, Barrier};
        const CONTENDERS: usize = 16;
        let state = ServerLifecycle::default();
        // Exercise both pre-bind ownership and an already listening lease.
        for listening in [false, true] {
            let start = Barrier::new(CONTENDERS + 1);
            let attempted = Barrier::new(CONTENDERS + 1);
            let release = Barrier::new(CONTENDERS + 1);
            let winners = AtomicUsize::new(0);
            let observed = std::thread::scope(|scope| {
                for _ in 0..CONTENDERS {
                    scope.spawn(|| {
                        start.wait();
                        let lease = state.try_start();
                        if let Some(ref owner) = lease {
                            winners.fetch_add(1, Ordering::Relaxed);
                            if listening {
                                owner.listening();
                            }
                        }
                        attempted.wait();
                        // Keep the winning lease alive until every contender tried.
                        release.wait();
                        drop(lease);
                    });
                }
                start.wait();
                attempted.wait();
                let observed = (
                    winners.load(Ordering::Relaxed),
                    state.running(),
                    state.try_start().is_none(),
                );
                release.wait();
                observed
            });
            assert_eq!(observed, (1, listening, true));
            assert!(!state.running());
            // A new owner is possible only after the previous lease was dropped.
            let next = state.try_start().unwrap();
            next.listening();
            assert!(state.running());
            drop(next);
        }
    }
}
