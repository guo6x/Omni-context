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

/// Case-insensitive ASCII prefix check that does not allocate.
fn prefix_eq_ignore_case(s: &str, prefix: &str) -> bool {
    match s.get(..prefix.len()) {
        Some(slice) => slice.eq_ignore_ascii_case(prefix),
        None => false,
    }
}

/// Redact credential-shaped and control-character material from captured
/// output. Returns the redacted string and whether anything changed.
pub fn redact(input: &str) -> (String, bool) {
    const REDACTED: &str = "[REDACTED]";
    const FAKE_SECRET: &str = "FAKE_SECRET_CP3_TEST_VALUE";
    const TOKEN_PREFIXES: [&str; 5] = ["github_pat_", "ghp_", "gho_", "ghu_", "ghs_"];

    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut changed = false;
    let mut i = 0usize;

    while i < bytes.len() {
        let rest = &input[i..];

        if rest.starts_with(FAKE_SECRET) {
            out.push_str(REDACTED);
            changed = true;
            i += FAKE_SECRET.len();
            continue;
        }

        let mut token_matched = false;
        for prefix in TOKEN_PREFIXES {
            if prefix_eq_ignore_case(rest, prefix) {
                let mut end = i + prefix.len();
                let mut count = 0usize;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                    && count < 512
                {
                    end += 1;
                    count += 1;
                }
                if count >= 20 {
                    out.push_str(REDACTED);
                    changed = true;
                    i = end;
                    token_matched = true;
                }
                break;
            }
        }
        if token_matched {
            continue;
        }

        if prefix_eq_ignore_case(rest, "bearer ") {
            let token_start = i + 7;
            let mut end = token_start;
            while end < bytes.len()
                && !bytes[end].is_ascii_whitespace()
                && bytes[end] != b'"'
                && bytes[end] != b','
                && bytes[end] != b';'
            {
                end += 1;
            }
            if end > token_start {
                out.push_str("Bearer ");
                out.push_str(REDACTED);
                changed = true;
                i = end;
                continue;
            }
        }

        if prefix_eq_ignore_case(rest, "authorization:") {
            let colon_end = i + "authorization:".len();
            let mut scan = colon_end;
            while scan < bytes.len() && bytes[scan].is_ascii_whitespace() {
                scan += 1;
            }
            let scheme = &input[scan..];
            if prefix_eq_ignore_case(scheme, "bearer") {
                let bearer_end = scan + "bearer".len();
                if bearer_end < bytes.len() && bytes[bearer_end].is_ascii_whitespace() {
                    let mut end = bearer_end + 1;
                    while end < bytes.len() && bytes[end] != b'\r' && bytes[end] != b'\n' {
                        end += 1;
                    }
                    out.push_str(&input[i..bearer_end]);
                    out.push(' ');
                    out.push_str(REDACTED);
                    changed = true;
                    i = end;
                    continue;
                }
            }
            let mut end = colon_end;
            while end < bytes.len() && bytes[end] != b'\r' && bytes[end] != b'\n' {
                end += 1;
            }
            out.push_str(&input[i..colon_end]);
            out.push(' ');
            out.push_str(REDACTED);
            changed = true;
            i = end;
            continue;
        }

        if rest.starts_with("://") {
            let mut at = i + 3;
            let mut found_at = false;
            while at < bytes.len() && at - i < 4096 {
                if bytes[at] == b'@' {
                    found_at = true;
                    break;
                }
                if bytes[at] == b'/' || bytes[at].is_ascii_whitespace() {
                    break;
                }
                at += 1;
            }
            if found_at {
                out.push_str("://");
                out.push_str(REDACTED);
                out.push('@');
                changed = true;
                i = at + 1;
                continue;
            }
        }

        let ch = rest.chars().next().unwrap_or('\0');
        let cp = ch as u32;
        if ch == '\u{1b}' {
            let mut j = i + 1;
            if j < bytes.len() && bytes[j] == b'[' {
                j += 1;
                while j < bytes.len()
                    && j - i < 64
                    && !(bytes[j].is_ascii_alphabetic() && bytes[j] != b'[')
                {
                    j += 1;
                }
                if j < bytes.len() {
                    j += 1;
                }
            }
            changed = true;
            i = j;
            continue;
        }
        let control = cp < 0x20 && ch != '\n' && ch != '\r' && ch != '\t';
        if control || cp == 0x7f {
            changed = true;
            i += ch.len_utf8();
            continue;
        }
        let mut buf = [0u8; 4];
        out.push_str(ch.encode_utf8(&mut buf));
        i += ch.len_utf8();
    }
    (out, changed)
}
