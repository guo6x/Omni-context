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
            Self::spawn_windows(command)
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

    /// Terminate the entire process tree (all descendants included).
    pub fn terminate(&mut self) -> Result<(), BrokerError> {
        #[cfg(windows)]
        {
            let Some(job) = self.job else {
                return Err(BrokerError::new(
                    ErrorCode::ProcessTreeFailure,
                    "job object already closed",
                ));
            };
            unsafe {
                windows::Win32::System::JobObjects::TerminateJobObject(job, 1).map_err(|e| {
                    BrokerError::new(
                        ErrorCode::ProcessTreeFailure,
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
                    ErrorCode::ProcessTreeFailure,
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
    fn spawn_windows(command: &mut Command) -> Result<Self, BrokerError> {
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
                ErrorCode::ProcessTreeFailure,
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
                    ErrorCode::ProcessTreeFailure,
                    format!("SetInformationJobObject failed: {e}"),
                )
            })
        };

        if let Err(e) = job_result {
            unsafe { CloseHandle(job) }.ok();
            return Err(e);
        }

        // 2. Spawn suspended so no child code runs before job assignment.
        command.creation_flags(CREATE_SUSPENDED);
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

        // 3. Assign the (still suspended) child to the job.
        let assign_result =
            unsafe { AssignProcessToJobObject(job, HANDLE(child.as_raw_handle() as isize)) };
        if let Err(e) = assign_result {
            // Cleanup: kill the suspended child via the job, reap it, close.
            let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(job, 1) };
            let _ = child.wait();
            unsafe { CloseHandle(job) }.ok();
            return Err(BrokerError::new(
                ErrorCode::ProcessTreeFailure,
                format!("AssignProcessToJobObject failed: {e}"),
            ));
        }

        // 4. Resume the child's primary thread.
        if let Err(e) = resume_primary_thread(child.id()) {
            let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(job, 1) };
            let _ = child.wait();
            unsafe { CloseHandle(job) }.ok();
            return Err(e);
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
fn resume_primary_thread(pid: u32) -> Result<(), BrokerError> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }.map_err(|e| {
        BrokerError::new(
            ErrorCode::ProcessTreeFailure,
            format!("CreateToolhelp32Snapshot failed: {e}"),
        )
    })?;

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

    let thread_id = tid.ok_or_else(|| {
        BrokerError::new(
            ErrorCode::ProcessTreeFailure,
            format!("primary thread not found for suspended process {pid}"),
        )
    })?;

    let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, thread_id) }.map_err(|e| {
        BrokerError::new(
            ErrorCode::ProcessTreeFailure,
            format!("OpenThread failed: {e}"),
        )
    })?;

    let previous_suspend_count = unsafe { ResumeThread(thread) };
    unsafe { CloseHandle(thread) }.ok();
    if previous_suspend_count == u32::MAX {
        return Err(BrokerError::new(
            ErrorCode::ProcessTreeFailure,
            format!("ResumeThread failed: {}", std::io::Error::last_os_error()),
        ));
    }
    Ok(())
}
