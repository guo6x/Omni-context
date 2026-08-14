//! Goal24 Checkpoint 7 (Integration) - exclusive persistence lock.
//!
//! A fail-closed single-instance authority boundary: while a broker holds a
//! persistent approval store / plan ledger, a sidecar `.lock` file carries an
//! exclusive OS-level lock. A second broker instance (same process or another
//! OS process) that points at the same durable state fails to acquire the
//! lock and opens degraded: every execute fails closed. The OS releases the
//! lock automatically when the owning process dies, so a crash never leaves a
//! stale lock behind.

use std::fs::OpenOptions;
use std::path::Path;

/// Held exclusive lock file handle. Dropping it (or process death) releases
/// the OS lock.
pub struct StoreFileLock {
    _file: std::fs::File,
}

impl StoreFileLock {
    /// Acquire an exclusive, non-blocking OS lock on `lock_path`.
    pub fn acquire(lock_path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|err| format!("cannot open lock file: {err}"))?;
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::Foundation::HANDLE;
            use windows::Win32::Storage::FileSystem::{
                LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
            };
            use windows::Win32::System::IO::OVERLAPPED;
            let handle = HANDLE(file.as_raw_handle() as isize);
            // LockFileEx requires a valid OVERLAPPED structure (the Win32
            // function dereferences it); a zeroed struct locks byte 0.
            let overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            unsafe {
                LockFileEx(
                    handle,
                    LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                    0,
                    1,
                    0,
                    &overlapped as *const OVERLAPPED as *mut OVERLAPPED,
                )
            }
            .map_err(|err| {
                format!(
                    "durable state is locked by another broker instance (single-instance authority): {err}"
                )
            })?;
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::io::AsRawFd;
            let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result != 0 {
                return Err(format!(
                    "durable state is locked by another broker instance (single-instance authority): flock failed"
                ));
            }
        }
        Ok(Self { _file: file })
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release_lock() {
        let dir = std::env::temp_dir().join(format!("omni-lock-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lock_path = dir.join("state.json.lock");
        let lock = StoreFileLock::acquire(&lock_path).expect("acquire");
        let again = StoreFileLock::acquire(&lock_path);
        assert!(again.is_err(), "second acquire must fail");
        drop(lock);
        let after = StoreFileLock::acquire(&lock_path);
        assert!(after.is_ok(), "re-acquire after drop must succeed");
        drop(after);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
