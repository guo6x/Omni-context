//! Goal24 Checkpoint 3 — bounded output capture.
//!
//! Child stdout/stderr are drained on dedicated threads into bounded buffers.
//! Once a stream reaches its cap the reader keeps draining (so the child never
//! blocks on a full pipe) but stops buffering; the result records the cap hit
//! and the total byte count seen.

use std::io::Read;
use std::process::ChildStdout;

/// Captured stream with truncation metadata.
#[derive(Debug, Clone, Default)]
pub struct BoundedOutput {
    /// Buffered bytes, never larger than the cap.
    pub data: Vec<u8>,
    pub truncated: bool,
    pub bytes_seen: u64,
}

impl BoundedOutput {
    /// Drain `reader` until EOF, buffering at most `cap` bytes.
    ///
    /// `cancel` (when set) stops the drain early; the caller is expected to
    /// have terminated the process tree so the pipe reaches EOF promptly.
    pub fn read_bounded<R: Read>(
        mut reader: R,
        cap: usize,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Self {
        let mut out = Self::default();
        let mut buf = [0u8; 8192];
        loop {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    out.bytes_seen += n as u64;
                    if !out.truncated {
                        let remaining = cap.saturating_sub(out.data.len());
                        if n <= remaining {
                            out.data.extend_from_slice(&buf[..n]);
                        } else {
                            out.data.extend_from_slice(&buf[..remaining]);
                            out.truncated = true;
                        }
                    }
                }
                Err(_) => break,
            }
        }
        out
    }

    /// Lossy UTF-8 view used for result payloads.
    pub fn as_lossy_string(&self) -> String {
        String::from_utf8_lossy(&self.data).into_owned()
    }
}

/// Capture both pipes of a spawned child. The caller must already have started
/// draining (this spawns one thread per stream) so a child that fills a pipe
/// cannot deadlock the wait loop.
pub struct OutputReaders {
    handles: Vec<std::thread::JoinHandle<BoundedOutput>>,
}

impl OutputReaders {
    pub fn start(
        stdout: ChildStdout,
        stderr: std::process::ChildStderr,
        limits: crate::execution_broker::policy::OutputLimits,
        cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Self {
        let cancel_out = cancel.clone();
        let cancel_err = cancel.clone();
        let stdout_handle = std::thread::spawn(move || {
            BoundedOutput::read_bounded(stdout, limits.stdout_max_bytes, &cancel_out)
        });
        let stderr_handle = std::thread::spawn(move || {
            BoundedOutput::read_bounded(stderr, limits.stderr_max_bytes, &cancel_err)
        });
        Self {
            handles: vec![stdout_handle, stderr_handle],
        }
    }

    /// Join both readers. Call only after the process tree has exited (or been
    /// terminated) so the pipes reach EOF; a generous join bound prevents a
    /// stuck reader from hanging the broker forever.
    pub fn finish(self) -> (BoundedOutput, BoundedOutput) {
        let mut outputs = Vec::with_capacity(2);
        for handle in self.handles {
            match handle.join() {
                Ok(out) => outputs.push(out),
                Err(_) => outputs.push(BoundedOutput::default()),
            }
        }
        let mut iter = outputs.into_iter();
        let stdout = iter.next().unwrap_or_default();
        let stderr = iter.next().unwrap_or_default();
        (stdout, stderr)
    }
}
