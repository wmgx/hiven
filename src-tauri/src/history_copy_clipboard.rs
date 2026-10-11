/// One process-wide marker, accessed only within the native clipboard lock.
/// This is history policy, not secrecy: explicit public reads remain unchanged.
/// External copies of identical text cannot be distinguished without an OS
/// change token; they remain excluded until another text is observed or a
/// successful ordinary Hiven copy clears the marker. Nothing is persisted.
pub(super) struct HistoryCopy {
    omitted: Option<String>,
}

impl HistoryCopy {
    pub(super) const fn new() -> Self {
        Self { omitted: None }
    }

    pub(super) fn write(
        &mut self,
        text: String,
        record: bool,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        // Bound the additional retained snapshot; reject, never truncate.
        if !record && text.len() > 8 * 1024 * 1024 {
            return Err("History-preserving copy exceeds the size limit".into());
        }
        write(&text)?;
        self.omitted = if record { None } else { Some(text) };
        Ok(())
    }

    pub(super) fn read(&mut self, text: String) -> String {
        if self.omitted.as_deref() == Some(text.as_str()) {
            String::new()
        } else {
            self.omitted = None;
            text
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HistoryCopy;
    use std::sync::{Arc, Mutex};

    #[test]
    fn history_filter_does_not_change_clipboard_or_explicit_reads() {
        let mut state = HistoryCopy::new();
        let mut clipboard = String::new();
        state.write("a\n\nb".into(), false, |value| {
            clipboard = value.to_owned();
            Ok(())
        }).unwrap();
        assert_eq!(clipboard, "a\n\nb");
        assert_eq!(state.read(clipboard.clone()), "");
        assert_eq!(state.read(clipboard.clone()), "");
        assert_eq!(clipboard, "a\n\nb");
    }

    #[test]
    fn failure_does_not_mark_attempted_text_or_clear_previous_marker() {
        let mut state = HistoryCopy::new();
        state.write("bundle".into(), false, |_| Ok(())).unwrap();
        assert!(state.write("failed".into(), false, |_| Err("failed".into())).is_err());
        assert_eq!(state.read("bundle".into()), "");
        assert_eq!(state.read("failed".into()), "failed");
        assert!(state.write("ordinary".into(), false, |_| Err("failed".into())).is_err());
        assert_eq!(state.read("ordinary".into()), "ordinary");
    }

    #[test]
    fn successful_ordinary_copy_and_observed_new_text_restore_recording() {
        let mut state = HistoryCopy::new();
        state.write("bundle".into(), false, |_| Ok(())).unwrap();
        state.write("bundle".into(), true, |_| Ok(())).unwrap();
        assert_eq!(state.read("bundle".into()), "bundle");
        state.write("bundle".into(), false, |_| Ok(())).unwrap();
        assert_eq!(state.read("new".into()), "new");
        assert_eq!(state.read("bundle".into()), "bundle");
    }

    #[test]
    fn shared_marker_covers_other_window_readers() {
        let shared = Arc::new(Mutex::new(HistoryCopy::new()));
        let writer = Arc::clone(&shared);
        std::thread::spawn(move || writer.lock().unwrap().write("bundle".into(), false, |_| Ok(()))).join().unwrap().unwrap();
        let reader = Arc::clone(&shared);
        assert_eq!(std::thread::spawn(move || reader.lock().unwrap().read("bundle".into())).join().unwrap(), "");
        assert_eq!(shared.lock().unwrap().read("bundle".into()), "");
    }

    #[test]
    fn oversized_copy_rejects_before_touching_clipboard() {
        let mut state = HistoryCopy::new();
        assert!(state.write("x".repeat(8 * 1024 * 1024 + 1), false, |_| panic!("must not write")).is_err());
    }
}
