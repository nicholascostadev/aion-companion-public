//! Bounded wakeups for the current captured world position. Payloads are read from
//! capture state after waking, so a slow consumer always receives the latest fix.
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};

#[derive(Default)]
pub(crate) struct Notifications {
    subscribers: Vec<SyncSender<()>>,
}

impl Notifications {
    pub(crate) fn subscribe(&mut self) -> Receiver<()> {
        let (sender, receiver) = sync_channel(1);
        // Bootstrap is queued before registration returns; a simultaneous capture
        // update coalesces into this wakeup rather than racing an initial read.
        let _ = sender.try_send(());
        self.subscribers.push(sender);
        receiver
    }

    pub(crate) fn notify(&mut self) {
        self.subscribers.retain(|sender| match sender.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) => true,
            Err(TrySendError::Disconnected(())) => false,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slow_subscribers_coalesce_without_blocking_capture_or_other_subscribers() {
        let mut notifications = Notifications::default();
        let slow = notifications.subscribe();
        let fast = notifications.subscribe();
        fast.recv().unwrap();
        for _ in 0..1000 {
            notifications.notify();
            fast.try_recv().unwrap();
        }
        assert_eq!(slow.try_iter().count(), 1);
        notifications.notify();
        slow.try_recv().unwrap();
    }

    #[test]
    fn unmounted_subscribers_are_removed_on_the_next_update() {
        let mut notifications = Notifications::default();
        let receiver = notifications.subscribe();
        drop(receiver);
        notifications.notify();
        assert!(notifications.subscribers.is_empty());
    }
}
