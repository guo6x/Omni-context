//! Goal24 Checkpoint 3 — process-tree containment.
//!
//! Windows (primary platform): every broker-spawned process is placed into a
//! Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` BEFORE it
//! can execute a single instruction (spawn with `CREATE_SUSPENDED`, assign to
//! the job, resume the primary thread). Timeout, cancellation and broker
//! teardown terminate the whole tree, so grandchildren cannot survive.
//!
//! `taskkill /T` is intentionally NOT used (it would itself be an extra
//! process execution and a PATH-dependent mechanism).
//!
//! Non-Windows fallback: a dedicated process group per child; termination
//! signals the whole group. Windows remains the containment guarantee target.

use std::process::{Child, Command};

use crate::execution_broker::types::{BrokerError, ErrorCode};

/// Keep the trusted Brain spawn path diagnosable without copying command
/// arguments, paths, or request data into the persistent log.  The PID,
/// lifecycle phase, and bounded Win32 return value are sufficient to tell a
/// suspended-child recovery failure from a Brain/SQLite startup failure.
#[cfg(windows)]
fn log_spawn_diagnostic(pid: u32, phase: &str, detail: &str) {
    crate::log_writer::write_line(
        &crate::log_writer::log_file_path(),
        &format!("[Desktop] ProcessTree pid={pid} phase={phase} {detail}"),
        true,
    );
}

/// A spawned process together with its containment mechanism.
pub struct ProcessTree {
    child: Child,
    #[cfg(windows)]
    job: Option<windows::Win32::Foundation::HANDLE>,
    #[cfg(unix)]
    pid: i32,
}

impl ProcessTree {
    /// Spawn `command` inside a fresh containment boundary.
    pub fn spawn(command: &mut Command) -> Result<Self, BrokerError> {
        #[cfg(windows)]
        {
            // Broker executions are untrusted and must not execute before the
            // Job Object containment boundary is installed.
            Self::spawn_windows(command, false, true)
        }
        #[cfg(not(windows))]
        {
            Self::spawn_unix(command)
        }
    }

    /// Spawn a background child without creating a visible console window.
    /// This is used by the embedded Brain runtime; broker commands retain the
    /// suspended-before-assign path above. Brain is a bundled, fixed entry
    /// point, so it must not execute any loader/native-module code before it
    /// is inside the kill-on-close Job Object. This is particularly important
    /// during a forced desktop stop: a native helper created before assignment
    /// would otherwise escape the Job and retain the profile database for the
    /// next launch. The primary thread is resumed only after assignment, with
    /// a bounded Toolhelp retry for the Windows thread-publication race.
    pub fn spawn_hidden(command: &mut Command) -> Result<Self, BrokerError> {
        #[cfg(windows)]
        {
            Self::spawn_windows(command, true, true)
        }
        #[cfg(not(windows))]
        {
            Self::spawn_unix(command)
        }
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    pub fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait()
    }

    /// Access to the underlying child (used to take the piped handles).
    pub fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }

    /// True when no process remains inside the containment boundary.
    /// On Windows this reads the Job Object's live process accounting;
    /// on Unix it probes the dedicated process group.
    pub fn is_empty(&self) -> bool {
        #[cfg(windows)]
        {
            use windows::Win32::System::JobObjects::{
                JobObjectBasicAccountingInformation, QueryInformationJobObject,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            };
            let Some(job) = self.job else {
                return true;
            };
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
            let ok = unsafe {
                QueryInformationJobObject(
                    job,
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
                        as *mut core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    None,
                )
            };
            ok.is_ok() && info.ActiveProcesses == 0
        }
        #[cfg(not(windows))]
        {
            // The direct child is reaped before this is called; the group
            // only still exists while a descendant is alive.
            let alive = unsafe { libc::kill(-self.pid, 0) };
            alive != 0
        }
    }

    /// Terminate the entire process tree (all descendants included).
    pub fn terminate(&mut self) -> Result<(), BrokerError> {
        #[cfg(windows)]
        {
            let Some(job) = self.job else {
                return Err(BrokerError::new(
                    ErrorCode::BrokerCrash,
                    "job object already closed",
                ));
            };
            unsafe {
                windows::Win32::System::JobObjects::TerminateJobObject(job, 1).map_err(|e| {
                    BrokerError::new(
                        ErrorCode::BrokerCrash,
                        format!("TerminateJobObject failed: {e}"),
                    )
                })?;
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            // Kill the whole process group (the child is the group leader).
            let result = unsafe { libc::kill(-self.pid, libc::SIGKILL) };
            if result == 0 {
                Ok(())
            } else {
                Err(BrokerError::new(
                    ErrorCode::BrokerCrash,
                    format!(
                        "kill(-{}, SIGKILL) failed: {}",
                        self.pid,
                        std::io::Error::last_os_error()
                    ),
                ))
            }
        }
    }

    #[cfg(windows)]
    fn spawn_windows(
        command: &mut Command,
        no_window: bool,
        start_suspended: bool,
    ) -> Result<Self, BrokerError> {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        const CREATE_SUSPENDED: u32 = 0x0000_0004;

        // 1. Create the job with KILL_ON_JOB_CLOSE.
        let job = unsafe { CreateJobObjectW(None, None) }.map_err(|e| {
            BrokerError::new(
                ErrorCode::BrokerCrash,
                format!("CreateJobObjectW failed: {e}"),
            )
        })?;

        let job_result = {
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                        as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            }
            .map_err(|e| {
                BrokerError::new(
                    ErrorCode::BrokerCrash,
                    format!("SetInformationJobObject failed: {e}"),
                )
            })
        };

        if let Err(e) = job_result {
            unsafe { CloseHandle(job) }.ok();
            return Err(e);
        }

        // 2. Spawn every Windows child suspended so no child code runs before
        // job assignment. The hidden flag only controls console visibility;
        // the trusted Brain path uses the same containment boundary as broker
        // commands and resumes through the bounded Toolhelp helper below.
        let hidden_flag = if no_window { 0x0800_0000 } else { 0 };
        let suspended_flag = if start_suspended { CREATE_SUSPENDED } else { 0 };
        command.creation_flags(suspended_flag | hidden_flag);
        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                unsafe { CloseHandle(job) }.ok();
                return Err(BrokerError::new(
                    ErrorCode::SpawnFailed,
                    format!("spawn failed: {e}"),
                ));
            }
        };
        if start_suspended && no_window {
            log_spawn_diagnostic(
                child.id(),
                "created_suspended",
                "creation_flags=CREATE_SUSPENDED",
            );
        }

        // 3. Assign the still-suspended child to the job. No child code can
        // run before this boundary is installed.
        let assign_result =
            unsafe { AssignProcessToJobObject(job, HANDLE(child.as_raw_handle() as isize)) };
        if let Err(e) = assign_result {
            // Cleanup: the child is not a member of the job when assignment
            // itself fails, so terminate the direct child explicitly before
            // reaping it. This also covers the trusted background path where
            // the child may already be running.
            let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(job, 1) };
            let _ = child.kill();
            let _ = child.wait();
            unsafe { CloseHandle(job) }.ok();
            return Err(BrokerError::new(
                ErrorCode::BrokerCrash,
                format!("AssignProcessToJobObject failed: {e}"),
            ));
        }
        if start_suspended && no_window {
            log_spawn_diagnostic(child.id(), "job_assigned", "kill_on_job_close=true");
        }

        // 4. Resume the child only after assignment. Toolhelp can briefly
        // publish no thread immediately after CreateProcessW; the bounded
        // retry keeps this trusted startup path fail-closed without turning a
        // transient Windows loader race into a false startup failure.
        if start_suspended {
            if let Err(e) = resume_primary_thread(child.id(), no_window) {
                if no_window {
                    log_spawn_diagnostic(child.id(), "resume_failed", &e.to_string());
                }
                let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(job, 1) };
                let _ = child.wait();
                unsafe { CloseHandle(job) }.ok();
                return Err(e);
            }
        }

        Ok(Self {
            child,
            job: Some(job),
        })
    }

    #[cfg(not(windows))]
    fn spawn_unix(command: &mut Command) -> Result<Self, BrokerError> {
        use std::os::unix::process::CommandExt;
        // Put the child in its own process group so we can kill the tree.
        command.process_group(0);
        let child = command
            .spawn()
            .map_err(|e| BrokerError::new(ErrorCode::SpawnFailed, format!("spawn failed: {e}")))?;
        Ok(Self {
            child,
            pid: child.id() as i32,
        })
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            // Closing the last job handle with KILL_ON_JOB_CLOSE terminates any
            // still-running members of the job (safety net; normal flow
            // terminates explicitly via `terminate()` + `wait()`).
            if let Some(job) = self.job.take() {
                unsafe { windows::Win32::Foundation::CloseHandle(job) }.ok();
            }
        }
        #[cfg(not(windows))]
        {
            let _ = self.terminate();
        }
    }
}

/// Find and resume the primary thread of a freshly created `CREATE_SUSPENDED`
/// process. A suspended process has exactly one thread, so the first thread in
/// the toolhelp snapshot owned by `pid` is the primary thread.
#[cfg(windows)]
fn resume_primary_thread(pid: u32, diagnostics: bool) -> Result<(), BrokerError> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    const RETRY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
    const RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);
    let deadline = std::time::Instant::now() + RETRY_TIMEOUT;
    let last_error = loop {
        let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) } {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let message = format!("CreateToolhelp32Snapshot failed: {error}");
                if std::time::Instant::now() >= deadline {
                    break message;
                }
                std::thread::sleep(RETRY_INTERVAL);
                continue;
            }
        };

        let mut tid: Option<u32> = None;
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if unsafe { Thread32First(snapshot, &mut entry) }.is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    tid = Some(entry.th32ThreadID);
                    break;
                }
                if unsafe { Thread32Next(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        unsafe { CloseHandle(snapshot) }.ok();

        let Some(thread_id) = tid else {
            let message = format!("primary thread not found for suspended process {pid}");
            if std::time::Instant::now() >= deadline {
                break message;
            }
            std::thread::sleep(RETRY_INTERVAL);
            continue;
        };

        let thread = match unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, thread_id) } {
            Ok(thread) => thread,
            Err(error) => {
                let message = format!("OpenThread failed: {error}");
                if std::time::Instant::now() >= deadline {
                    break message;
                }
                std::thread::sleep(RETRY_INTERVAL);
                continue;
            }
        };

        // `CREATE_SUSPENDED` normally gives the primary thread a suspend
        // count of one.  Windows can publish a larger count while process
        // creation is being finalized (for example when a launcher or job
        // policy suspends the process as well).  One ResumeThread call would
        // then report success while leaving the child permanently suspended;
        // the native supervisor would observe a live PID with no Brain logs
        // until its health timeout.  Keep the handle open and drain the
        // count to zero, bounded by the same startup retry deadline.
        let resume_error = loop {
            let previous_suspend_count = unsafe { ResumeThread(thread) };
            if previous_suspend_count == u32::MAX {
                let message = format!(
                    "ResumeThread failed for pid={pid}: {}",
                    std::io::Error::last_os_error()
                );
                if diagnostics {
                    log_spawn_diagnostic(pid, "resume_return", &message);
                }
                if std::time::Instant::now() >= deadline {
                    break Some(message);
                }
                std::thread::sleep(RETRY_INTERVAL);
                break Some(message);
            }
            if diagnostics {
                log_spawn_diagnostic(
                    pid,
                    "resume_return",
                    &format!("previous_suspend_count={previous_suspend_count}"),
                );
            }
            if previous_suspend_count <= 1 {
                unsafe { CloseHandle(thread) }.ok();
                if diagnostics {
                    log_spawn_diagnostic(pid, "resume_complete", "suspend_count=0");
                }
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                let message = format!(
                    "ResumeThread left pid={pid} suspended (previous count {previous_suspend_count})"
                );
                if diagnostics {
                    log_spawn_diagnostic(pid, "resume_incomplete", &message);
                }
                break Some(message);
            }
            std::thread::sleep(RETRY_INTERVAL);
        };
        unsafe { CloseHandle(thread) }.ok();
        if let Some(message) = resume_error {
            if std::time::Instant::now() >= deadline {
                break message;
            }
            std::thread::sleep(RETRY_INTERVAL);
            continue;
        }
        if std::time::Instant::now() >= deadline {
            break "primary thread resume retry deadline exceeded".to_string();
        }
        std::thread::sleep(RETRY_INTERVAL);
    };

    Err(BrokerError::new(
        ErrorCode::BrokerCrash,
        format!("{} (after {} ms)", last_error, RETRY_TIMEOUT.as_millis()),
    ))
}
