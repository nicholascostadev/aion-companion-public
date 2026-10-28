//! One filesystem owner. Replaceable observations have one mailbox per file;
//! acknowledged work is bounded and must be submitted outside capture state.
use serde::Serialize;
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{mpsc, Arc, Condvar, Mutex},
    thread,
};

#[derive(Clone)]
pub(super) struct Write {
    path: PathBuf,
    execute: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
}
impl Write {
    pub fn execute(&self) -> Result<(), String> {
        (self.execute)()
    }
    pub fn json<T: Serialize + Send + Sync + 'static>(path: PathBuf, value: T) -> Self {
        let destination = path.clone();
        Self {
            path,
            execute: Arc::new(move || atomic(&destination, &value)),
        }
    }
    pub fn remove(path: PathBuf) -> Self {
        let destination = path.clone();
        Self {
            path,
            execute: Arc::new(move || crate::persistence::remove(&destination)),
        }
    }
    pub fn archive(path: PathBuf, destination: PathBuf) -> Self {
        let source = path.clone();
        Self {
            path,
            execute: Arc::new(move || crate::persistence::archive(&source, &destination)),
        }
    }
    pub fn json_arc<T: Serialize + Send + Sync + 'static>(path: PathBuf, value: Arc<T>) -> Self {
        let destination = path.clone();
        Self {
            path,
            execute: Arc::new(move || atomic(&destination, &*value)),
        }
    }
}
pub(super) fn atomic(path: &std::path::Path, value: &impl Serialize) -> Result<(), String> {
    crate::persistence::write_json(path, value)
}
enum Request {
    Write(Vec<Write>, Vec<Write>, mpsc::SyncSender<Result<(), String>>),
    Flush(mpsc::SyncSender<Result<(), String>>),
}
#[derive(Default)]
struct State {
    queue: VecDeque<Request>,
    checkpoints: BTreeMap<PathBuf, Write>,
    failed: BTreeMap<PathBuf, (Write, String)>,
    closed: bool,
}
pub(super) struct Storage {
    state: Arc<(Mutex<State>, Condvar)>,
    worker: Option<thread::JoinHandle<()>>,
    /// Orders taking prepared encounter saves and their acknowledgements.
    pub dispatch: Mutex<()>,
}
impl Storage {
    pub fn new() -> Result<Arc<Self>, String> {
        let state = Arc::new((Mutex::new(State::default()), Condvar::new()));
        let input = state.clone();
        let worker = thread::Builder::new()
            .name("aion-local-storage".into())
            .spawn(move || work(input))
            .map_err(|e| e.to_string())?;
        Ok(Arc::new(Self {
            state,
            worker: Some(worker),
            dispatch: Mutex::new(()),
        }))
    }
    /// Only active.json, pets.json and alerts.json use this replaceable lane.
    pub fn checkpoint(&self, write: Write) -> Result<(), String> {
        let (lock, wake) = &*self.state;
        let mut state = lock.lock().map_err(|_| "Storage unavailable")?;
        if state.closed {
            return Err("Storage is closed".into());
        }
        if !state.checkpoints.contains_key(&write.path) && state.checkpoints.len() >= 3 {
            return Err("Checkpoint mailbox is full".into());
        }
        state.checkpoints.insert(write.path.clone(), write);
        wake.notify_one();
        Ok(())
    }
    pub fn write(&self, writes: Vec<Write>) -> Result<(), String> {
        self.request(|reply| Request::Write(writes, Vec::new(), reply))
    }
    pub fn flush(&self) -> Result<(), String> {
        self.request(Request::Flush)
    }
    pub fn error(&self) -> Option<String> {
        self.state
            .0
            .lock()
            .ok()?
            .failed
            .values()
            .next()
            .map(|(_, e)| e.clone())
    }
    pub fn error_for(&self, path: &std::path::Path) -> Option<String> {
        self.state
            .0
            .lock()
            .ok()?
            .failed
            .get(path)
            .map(|(_, error)| error.clone())
    }
    fn request(
        &self,
        build: impl FnOnce(mpsc::SyncSender<Result<(), String>>) -> Request,
    ) -> Result<(), String> {
        let (reply, receive) = mpsc::sync_channel(1);
        let (lock, wake) = &*self.state;
        let mut state = lock.lock().map_err(|_| "Storage unavailable")?;
        while state.queue.len() >= 4 && !state.closed {
            state = wake.wait(state).map_err(|_| "Storage unavailable")?;
        }
        if state.closed {
            return Err("Storage is closed".into());
        }
        let mut request = build(reply);
        if let Request::Write(writes, superseded, _) = &mut request {
            for write in writes {
                // A newer acknowledged snapshot supersedes pending observations.
                if let Some(previous) = state.checkpoints.remove(&write.path) {
                    superseded.push(previous);
                    state.failed.remove(&write.path);
                } else if let Some((previous, _)) = state.failed.remove(&write.path) {
                    superseded.push(previous);
                }
            }
        }
        state.queue.push_back(request);
        wake.notify_all();
        drop(state);
        receive
            .recv()
            .map_err(|_| "Storage worker exited unexpectedly")?
    }
}
impl Drop for Storage {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.0.lock() {
            state.closed = true;
            self.state.1.notify_all();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn checkpoints(state: &Arc<(Mutex<State>, Condvar)>, retry: bool) {
    let writes = {
        let mut s = state.0.lock().unwrap();
        if retry {
            let failed = std::mem::take(&mut s.failed);
            for (path, (write, _)) in failed {
                s.checkpoints.entry(path).or_insert(write);
            }
        }
        std::mem::take(&mut s.checkpoints)
    };
    for (path, write) in writes {
        let result = (write.execute)();
        let mut s = state.0.lock().unwrap();
        match result {
            Ok(()) => {
                s.failed.remove(&path);
            }
            Err(error) => {
                crate::diagnostics::record("error", "storage-checkpoint", &error);
                s.failed.insert(path, (write, error));
            }
        }
    }
}
fn work(state: Arc<(Mutex<State>, Condvar)>) {
    loop {
        let request = {
            let mut s = state.0.lock().unwrap();
            while s.queue.is_empty() && s.checkpoints.is_empty() && !s.closed {
                s = state.1.wait(s).unwrap();
            }
            if s.closed && s.queue.is_empty() && s.checkpoints.is_empty() {
                break;
            }
            let request = s.queue.pop_front();
            state.1.notify_all();
            request
        };
        match request {
            Some(Request::Write(writes, superseded, reply)) => {
                let result = writes.iter().try_for_each(|write| (write.execute)());
                let mut s = state.0.lock().unwrap();
                match &result {
                    Ok(()) => {
                        for write in &writes {
                            s.failed.remove(&write.path);
                        }
                    }
                    Err(error) => {
                        crate::diagnostics::record("error", "storage-write", error);
                        for previous in superseded {
                            if !s.checkpoints.contains_key(&previous.path) {
                                s.failed
                                    .insert(previous.path.clone(), (previous, error.clone()));
                            }
                        }
                    }
                }
                drop(s);
                let _ = reply.send(result);
            }
            Some(Request::Flush(reply)) => {
                checkpoints(&state, true);
                let result = state
                    .0
                    .lock()
                    .unwrap()
                    .failed
                    .values()
                    .next()
                    .map_or(Ok(()), |(_, e)| Err(e.clone()));
                let _ = reply.send(result);
            }
            None => checkpoints(&state, false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn checkpoints_coalesce_and_acknowledged_writes_supersede_pending_snapshots() {
        let storage = Storage::new().unwrap();
        let (started, ready) = mpsc::sync_channel(1);
        let (release, gate) = mpsc::sync_channel(1);
        let gate = Mutex::new(gate);
        storage
            .checkpoint(Write {
                path: "block".into(),
                execute: Arc::new(move || {
                    started.send(()).unwrap();
                    gate.lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    Ok(())
                }),
            })
            .unwrap();
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let result = Arc::new(AtomicUsize::new(0));
        for i in 1..=1000 {
            let result = result.clone();
            storage
                .checkpoint(Write {
                    path: "active.json".into(),
                    execute: Arc::new(move || {
                        result.store(i, Ordering::SeqCst);
                        Ok(())
                    }),
                })
                .unwrap();
        }
        assert_eq!(storage.state.0.lock().unwrap().checkpoints.len(), 1);
        let writer = storage.clone();
        let observed = result.clone();
        let thread = thread::spawn(move || {
            writer.write(vec![Write {
                path: "active.json".into(),
                execute: Arc::new(move || {
                    observed.store(2000, Ordering::SeqCst);
                    Ok(())
                }),
            }])
        });
        {
            let mut s = storage.state.0.lock().unwrap();
            while s.queue.is_empty() {
                let (next, timeout) = storage
                    .state
                    .1
                    .wait_timeout(s, Duration::from_secs(5))
                    .unwrap();
                s = next;
                assert!(!timeout.timed_out());
            }
            assert!(s.checkpoints.is_empty());
        }
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
        storage.flush().unwrap();
        assert_eq!(result.load(Ordering::SeqCst), 2000);
    }

    #[test]
    fn failed_checkpoint_is_visible_and_flush_retries_it() {
        let storage = Storage::new().unwrap();
        let writable = Arc::new(AtomicBool::new(false));
        let gate = writable.clone();
        storage
            .checkpoint(Write {
                path: "pets.json".into(),
                execute: Arc::new(move || {
                    if gate.load(Ordering::SeqCst) {
                        Ok(())
                    } else {
                        Err("disk unavailable".into())
                    }
                }),
            })
            .unwrap();
        assert_eq!(storage.flush().unwrap_err(), "disk unavailable");
        assert_eq!(storage.error().as_deref(), Some("disk unavailable"));
        writable.store(true, Ordering::SeqCst);
        storage.flush().unwrap();
        assert!(storage.error().is_none());
    }

    #[test]
    fn a_failed_inflight_checkpoint_cannot_overwrite_a_newer_confirmed_save() {
        let storage = Storage::new().unwrap();
        let (started, ready) = mpsc::sync_channel(1);
        let (release, gate) = mpsc::sync_channel(1);
        let gate = Mutex::new(gate);
        storage
            .checkpoint(Write {
                path: "active.json".into(),
                execute: Arc::new(move || {
                    started.send(()).unwrap();
                    gate.lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    Err("old checkpoint failed".into())
                }),
            })
            .unwrap();
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let writer = storage.clone();
        let saved = thread::spawn(move || {
            writer.write(vec![Write {
                path: "active.json".into(),
                execute: Arc::new(|| Ok(())),
            }])
        });
        {
            let mut state = storage.state.0.lock().unwrap();
            while state.queue.is_empty() {
                let (next, timeout) = storage
                    .state
                    .1
                    .wait_timeout(state, Duration::from_secs(5))
                    .unwrap();
                state = next;
                assert!(!timeout.timed_out());
            }
        }
        release.send(()).unwrap();
        saved.join().unwrap().unwrap();
        storage.flush().unwrap();
        assert!(storage.error().is_none());
    }

    #[test]
    fn reliable_queue_applies_backpressure_and_acknowledges_every_request() {
        let storage = Storage::new().unwrap();
        let (started, ready) = mpsc::sync_channel(1);
        let (release, gate) = mpsc::sync_channel(1);
        let gate = Mutex::new(gate);
        storage
            .checkpoint(Write {
                path: "block".into(),
                execute: Arc::new(move || {
                    started.send(()).unwrap();
                    gate.lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    Ok(())
                }),
            })
            .unwrap();
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let saved = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..10)
            .map(|i| {
                let writer = storage.clone();
                let saved = saved.clone();
                thread::spawn(move || {
                    writer.write(vec![Write {
                        path: format!("saved-{i}.json").into(),
                        execute: Arc::new(move || {
                            saved.fetch_add(1, Ordering::SeqCst);
                            Ok(())
                        }),
                    }])
                })
            })
            .collect();
        {
            let mut state = storage.state.0.lock().unwrap();
            while state.queue.len() < 4 {
                let (next, timeout) = storage
                    .state
                    .1
                    .wait_timeout(state, Duration::from_secs(5))
                    .unwrap();
                state = next;
                assert!(!timeout.timed_out());
            }
            assert_eq!(state.queue.len(), 4);
        }
        assert_eq!(saved.load(Ordering::SeqCst), 0);
        release.send(()).unwrap();
        for thread in threads {
            thread.join().unwrap().unwrap();
        }
        assert_eq!(saved.load(Ordering::SeqCst), 10);
    }
}
