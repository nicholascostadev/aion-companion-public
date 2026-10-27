//! Prepares writes under capture state; waits for the filesystem owner without it.
use crate::{storage::Storage, Shared};
use std::sync::{Mutex, MutexGuard};

pub(super) fn flush(shared: &Mutex<Shared>, checkpoints: bool) -> Result<(), String> {
    crate::alerts_api::flush(shared)?;
    operation(shared, |_| Ok(()), checkpoints)
}

/// Return capture state only when every earlier encounter batch is acknowledged.
/// Failed batches remain available for retry before another mutation can replace them.
fn drained<'a>(
    shared: &'a Mutex<Shared>,
    storage: &Storage,
) -> Result<MutexGuard<'a, Shared>, String> {
    loop {
        let state = shared.lock().map_err(|_| "Capture state unavailable")?;
        let Some(writes) = state.offline.pending_saves.front().cloned() else {
            return Ok(state);
        };
        drop(state);
        let result = storage.write(writes);
        let mut state = shared.lock().map_err(|_| "Capture state unavailable")?;
        match result {
            Ok(()) => {
                state.offline.pending_saves.pop_front();
                state.offline.persistence_error = None;
            }
            Err(error) => {
                state.offline.persistence_error = Some(error.clone());
                return Err(error);
            }
        }
    }
}

pub(super) fn operation<T>(
    shared: &Mutex<Shared>,
    operation: impl FnOnce(&mut Shared) -> Result<T, String>,
    checkpoints: bool,
) -> Result<T, String> {
    let storage = shared
        .lock()
        .map_err(|_| "Capture state unavailable")?
        .offline
        .storage
        .clone();
    let Some(storage) = storage else {
        return operation(&mut *shared.lock().map_err(|_| "Capture state unavailable")?);
    };
    let _dispatch = storage
        .dispatch
        .lock()
        .map_err(|_| "Storage dispatch unavailable")?;
    let mut state = drained(shared, &storage)?;
    let result = operation(&mut state);
    drop(state);
    let mut state = drained(shared, &storage)?;
    // Clearing active.json cannot race ahead of the completed encounter save.
    let checkpoint = state.offline.pending_checkpoint.take();
    drop(state);
    if let Some(checkpoint) = checkpoint {
        storage.checkpoint(checkpoint)?;
    }
    if checkpoints {
        storage.flush()?;
    }
    result
}
