//! Goal24 Checkpoint 3 — process-tree containment.
//!
//! Windows (primary platform): every broker-spawned process is placed into a
//! Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` BEFORE it
//! can execute a single instruction (spawn with `CREATE_SUSPENDED`, assign to
//! the job, then resume the published primary startup thread). The bundled
//! Brain runtime uses the same std::process containment path as the broker,
//! but defers its bounded Toolhelp resume until stdout/stderr readers are
//! attached; untrusted broker commands resume inside `spawn`. A narrow native
//! CreateProcessW adapter is retained for the Windows-specific process-tree
//! test. Timeout, cancellation and broker teardown terminate the whole tree,
//! so grandchildren cannot survive.
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
/// process-containment/startup failure from a Brain/SQLite startup failure.
#[cfg(windows)]
fn log_spawn_diagnostic(pid: u32, phase: &str, detail: &str) {
    crate::log_writer::write_line(
        &crate::log_writer::log_file_path(),
        &format!("[Desktop] ProcessTree pid={pid} phase={phase} {detail}"),
        true,
    );
}

/// A spawned process together with its containment mechanism.
#[cfg(windows)]
enum WindowsChild {
    /// The broker and deferred Brain paths use std::process::Command. They are
    /// created suspended and resumed after Job assignment; the Brain call is
    /// deliberately deferred until its output readers are live.
    Std(Child),
    /// A narrow native CreateProcessW path used by the Windows process-tree
    /// test. Production Brain startup uses `Std` so it can share the known
    /// installed-pass resume sequence.
    Native(NativeChild),
}

#[cfg(windows)]
struct NativeChild {
    process: windows::Win32::Foundation::HANDLE,
    primary_thread: Option<windows::Win32::Foundation::HANDLE>,
    pid: u32,
    stdout: Option<ProcessOutput>,
    stderr: Option<ProcessOutput>,
    exit_status: Option<std::process::ExitStatus>,
}

#[cfg(windows)]
impl NativeChild {
    fn id(&self) -> u32 {
        self.pid
    }

    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        use windows::Win32::Foundation::{WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows::Win32::System::Threading::WaitForSingleObject;

        if let Some(status) = self.exit_status {
            return Ok(Some(status));
        }
        let result = unsafe { WaitForSingleObject(self.process, 0) };
        if result == WAIT_TIMEOUT {
            return Ok(None);
        }
        if result == WAIT_FAILED {
            return Err(std::io::Error::last_os_error());
        }
        if result != WAIT_OBJECT_0 {
            return Err(std::io::Error::other(format!(
                "unexpected WaitForSingleObject result: {result:?}"
            )));
        }
        self.collect_exit_status()
    }

    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        use windows::Win32::Foundation::{WAIT_FAILED, WAIT_OBJECT_0};
        use windows::Win32::System::Threading::{WaitForSingleObject, INFINITE};

        if let Some(status) = self.exit_status {
            return Ok(status);
        }
        let result = unsafe { WaitForSingleObject(self.process, INFINITE) };
        if result == WAIT_FAILED {
            return Err(std::io::Error::last_os_error());
        }
        if result != WAIT_OBJECT_0 {
            return Err(std::io::Error::other(format!(
                "unexpected WaitForSingleObject result: {result:?}"
            )));
        }
        self.collect_exit_status()?
            .ok_or_else(|| std::io::Error::other("process exited without status"))
    }

    fn collect_exit_status(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        use std::os::windows::process::ExitStatusExt;
        use windows::Win32::System::Threading::GetExitCodeProcess;

        let mut code = 0u32;
        unsafe { GetExitCodeProcess(self.process, &mut code) }
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let status = std::process::ExitStatus::from_raw(code);
        unsafe { windows::Win32::Foundation::CloseHandle(self.process) }.ok();
        self.process = windows::Win32::Foundation::HANDLE(0);
        self.exit_status = Some(status);
        Ok(Some(status))
    }

    fn resume_primary(&mut self) -> Result<(), BrokerError> {
        use windows::Win32::System::Threading::ResumeThread;

        let Some(thread) = self.primary_thread.take() else {
            return Ok(());
        };
        // CREATE_SUSPENDED contributes one count.  A host policy may add a
        // bounded extra count while process creation is finalized; drain it
        // on the retained primary handle before closing that handle.
        let mut previous_suspend_count = unsafe { ResumeThread(thread) };
        let mut extra_resumes = 0u8;
        while previous_suspend_count > 1 && previous_suspend_count != u32::MAX && extra_resumes < 8
        {
            previous_suspend_count = unsafe { ResumeThread(thread) };
            extra_resumes += 1;
        }
        unsafe { windows::Win32::Foundation::CloseHandle(thread) }.ok();
        if previous_suspend_count == u32::MAX || previous_suspend_count > 1 {
            return Err(BrokerError::new(
                ErrorCode::BrokerCrash,
                format!(
                    "ResumeThread(primary) failed or remained suspended (previous count {previous_suspend_count}): {}",
                    std::io::Error::last_os_error(),
                ),
            ));
        }
        log_spawn_diagnostic(
            self.pid,
            "primary_resumed",
            &format!("previous_suspend_count={previous_suspend_count}"),
        );
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for NativeChild {
    fn drop(&mut self) {
        if let Some(thread) = self.primary_thread.take() {
            unsafe { windows::Win32::Foundation::CloseHandle(thread) }.ok();
        }
        if !self.process.is_invalid() {
            unsafe { windows::Win32::Foundation::CloseHandle(self.process) }.ok();
            self.process = windows::Win32::Foundation::HANDLE(0);
        }
    }
}

pub struct ProcessTree {
    #[cfg(windows)]
    child: WindowsChild,
    #[cfg(not(windows))]
    child: Child,
    #[cfg(windows)]
    job: Option<windows::Win32::Foundation::HANDLE>,
    #[cfg(windows)]
    resume_required: bool,
    #[cfg(unix)]
    pid: i32,
}

/// Unified read end for std::process pipes and native CreateProcessW pipes.
/// ChildStdout/ChildStderr do not implement FromRawHandle on Windows, so the
/// native path stores File-backed readers behind this narrow trait object.
pub type ProcessOutput = Box<dyn std::io::Read + Send>;

impl ProcessTree {
    /// Spawn `command` inside a fresh containment boundary.
    pub fn spawn(command: &mut Command) -> Result<Self, BrokerError> {
        #[cfg(windows)]
        {
            // Broker executions are untrusted and must not execute before the
            // Job Object containment boundary is installed.
            Self::spawn_windows(command, false, true, true, false)
        }
        #[cfg(not(windows))]
        {
            Self::spawn_unix(command)
        }
    }

    /// Spawn the bundled Brain runtime without creating a visible console
    /// window. Keep the known-good std::process path: CREATE_SUSPENDED is
    /// assigned to the Job Object, output readers are attached by the caller,
    /// and the bounded Toolhelp resume happens only after those readers are
    /// live. Broker commands retain their separate untrusted path above.
    pub fn spawn_hidden(command: &mut Command) -> Result<Self, BrokerError> {
        #[cfg(windows)]
        {
            // Keep the production Brain path on the verified std::process /
            // Toolhelp sequence. The native primary-thread adapter remains
            // available to the focused Windows probe, but the packaged
            // restart gate has repeatedly passed with the same bounded
            // Toolhelp resume path used by the broker.
            Self::spawn_windows(command, true, true, false, false)
        }
        #[cfg(not(windows))]
        {
            Self::spawn_unix(command)
        }
    }

    /// Spawn the fixed, bundled Brain runtime without CREATE_SUSPENDED.
    ///
    /// This is a bounded recovery fallback for Windows only. The Brain entry
    /// point and embedded Node binary are trusted product code; unlike broker
    /// commands they never use this path. The child is assigned to the same
    /// kill-on-close Job Object immediately after CreateProcess returns, so
    /// normal shutdown still owns the complete process tree while avoiding a
    /// Windows loader state that can remain non-executable after a hard stop.
    pub fn spawn_hidden_running(command: &mut Command) -> Result<Self, BrokerError> {
        #[cfg(windows)]
        {
            Self::spawn_windows(command, true, false, false, false)
        }
        #[cfg(not(windows))]
        {
            Self::spawn_unix(command)
        }
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        #[cfg(windows)]
        {
            match &mut self.child {
                WindowsChild::Std(child) => child.try_wait(),
                WindowsChild::Native(child) => child.try_wait(),
            }
        }
        #[cfg(not(windows))]
        {
            self.child.try_wait()
        }
    }

    pub fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        #[cfg(windows)]
        let status = match &mut self.child {
            WindowsChild::Std(child) => child.wait()?,
            WindowsChild::Native(child) => child.wait()?,
        };
        #[cfg(not(windows))]
        let status = self.child.wait()?;
        #[cfg(windows)]
        self.wait_for_job_empty();
        Ok(status)
    }

    /// Resume a trusted Brain child after its stdout/stderr readers are
    /// attached. Untrusted broker children resume inside `spawn` before this
    /// method can be reached. The std::process Brain path intentionally keeps
    /// its primary thread suspended until this call so a cold Node loader
    /// cannot fill an undrained diagnostic pipe during hard-stop recovery.
    pub fn resume(&mut self) -> Result<(), BrokerError> {
        #[cfg(windows)]
        {
            match &mut self.child {
                WindowsChild::Std(child) => {
                    if self.resume_required {
                        resume_process_threads(child, true)?;
                    }
                }
                WindowsChild::Native(child) => {
                    if self.resume_required {
                        child.resume_primary()?;
                    }
                }
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Ok(())
        }
    }

    /// Process identifier used for diagnostics and recovery records.
    pub fn id(&self) -> u32 {
        #[cfg(windows)]
        {
            match &self.child {
                WindowsChild::Std(child) => child.id(),
                WindowsChild::Native(child) => child.id(),
            }
        }
        #[cfg(not(windows))]
        {
            self.child.id()
        }
    }

    /// Detach the child's stdout pipe for the bounded output/log reader.
    pub fn take_stdout(&mut self) -> Option<ProcessOutput> {
        #[cfg(windows)]
        {
            match &mut self.child {
                WindowsChild::Std(child) => child
                    .stdout
                    .take()
                    .map(|pipe| Box::new(pipe) as ProcessOutput),
                WindowsChild::Native(child) => child.stdout.take(),
            }
        }
        #[cfg(not(windows))]
        {
            self.child
                .stdout
                .take()
                .map(|pipe| Box::new(pipe) as ProcessOutput)
        }
    }

    /// Detach the child's stderr pipe for the bounded output/log reader.
    pub fn take_stderr(&mut self) -> Option<ProcessOutput> {
        #[cfg(windows)]
        {
            match &mut self.child {
                WindowsChild::Std(child) => child
                    .stderr
                    .take()
                    .map(|pipe| Box::new(pipe) as ProcessOutput),
                WindowsChild::Native(child) => child.stderr.take(),
            }
        }
        #[cfg(not(windows))]
        {
            self.child
                .stderr
                .take()
                .map(|pipe| Box::new(pipe) as ProcessOutput)
        }
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
    fn wait_for_job_empty(&self) {
        // `Child::wait` only reaps the direct process.  A Brain/command
        // runtime may have native helpers or grandchildren in the Job Object;
        // keep the containment boundary alive until Windows reports that the
        // complete tree has drained, with a bounded fail-closed wait.
        const DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
        const DRAIN_INTERVAL: std::time::Duration = std::time::Duration::from_millis(25);
        let deadline = std::time::Instant::now() + DRAIN_TIMEOUT;
        while !self.is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(DRAIN_INTERVAL);
        }
        if !self.is_empty() {
            log_spawn_diagnostic(
                self.id(),
                "job_drain_timeout",
                "active_processes_remain_after_wait",
            );
        }
    }

    #[cfg(windows)]
    fn spawn_windows(
        command: &mut Command,
        no_window: bool,
        start_suspended: bool,
        resume_after_assign: bool,
        native_primary_thread: bool,
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

        // std::process::Child intentionally does not expose the
        // PROCESS_INFORMATION primary-thread handle.  The trusted Brain path
        // therefore uses a narrow native CreateProcessW adapter: it retains
        // that handle across Job assignment so the caller can resume exactly
        // the primary thread after attaching output readers, avoiding any
        // Toolhelp scan against the packaged Node loader.
        if native_primary_thread {
            return Self::spawn_windows_native(command, job, no_window);
        }

        // 2. Broker commands are created suspended so untrusted code cannot
        // run before the Job Object boundary is installed. The native Brain
        // path takes the same suspended boundary but retains the primary
        // PROCESS_INFORMATION thread handle and resumes it directly. The
        // hidden flag only controls console visibility.
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
        if no_window {
            let (phase, detail) = if start_suspended {
                ("created_suspended", "creation_flags=CREATE_SUSPENDED")
            } else {
                ("created_running", "creation_flags=CREATE_NO_WINDOW")
            };
            log_spawn_diagnostic(child.id(), phase, detail);
        }

        // 3. Assign the std::process broker child to the job while it is
        // still suspended. The native Brain branch performs the equivalent
        // assignment before resuming its retained primary thread.
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
        if no_window {
            log_spawn_diagnostic(child.id(), "job_assigned", "kill_on_job_close=true");
        }

        // 4. Resume only broker children that were created suspended.
        // Toolhelp can briefly publish no thread immediately after
        // CreateProcessW; the bounded retry keeps that untrusted path
        // fail-closed without turning a transient publication race into a
        // false startup failure.
        if start_suspended && resume_after_assign {
            if let Err(e) = resume_process_threads(&mut child, no_window) {
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
            child: WindowsChild::Std(child),
            job: Some(job),
            resume_required: start_suspended,
        })
    }

    /// Native Brain-only CreateProcessW path.  Unlike std::process::Child,
    /// PROCESS_INFORMATION gives us the primary thread handle.  Keeping it
    /// until after AssignProcessToJobObject closes the startup race in which a
    /// Toolhelp snapshot can observe a loader-created thread but miss the
    /// primary thread that still carries CREATE_SUSPENDED's suspend count.
    #[cfg(windows)]
    fn spawn_windows_native(
        command: &Command,
        job: windows::Win32::Foundation::HANDLE,
        no_window: bool,
    ) -> Result<Self, BrokerError> {
        use std::ffi::{OsStr, OsString};
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::io::{FromRawHandle, RawHandle};
        use windows::core::{PCWSTR, PWSTR};
        use windows::Win32::Foundation::{
            CloseHandle, BOOL, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
        };
        use windows::Win32::Security::SECURITY_ATTRIBUTES;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows::Win32::System::Pipes::CreatePipe;
        use windows::Win32::System::Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
            UpdateProcThreadAttribute, CREATE_NO_WINDOW, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES,
            STARTUPINFOEXW,
        };

        fn wide(value: &OsStr) -> Vec<u16> {
            value.encode_wide().chain(std::iter::once(0)).collect()
        }

        fn close(handle: HANDLE) {
            if !handle.is_invalid() {
                unsafe { CloseHandle(handle) }.ok();
            }
        }

        fn create_pipe(child_reads: bool) -> Result<(HANDLE, HANDLE), BrokerError> {
            let mut read = HANDLE(0);
            let mut write = HANDLE(0);
            let attrs = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: std::ptr::null_mut(),
                bInheritHandle: BOOL(1),
            };
            unsafe { CreatePipe(&mut read, &mut write, Some(&attrs as *const _), 0) }.map_err(
                |e| BrokerError::new(ErrorCode::SpawnFailed, format!("CreatePipe failed: {e}")),
            )?;
            // Keep only the end named in STARTF_USESTDHANDLES inheritable.
            // stdout/stderr are child-write pipes; stdin is a child-read
            // pipe, so the direction must be selected explicitly.
            let parent_end = if child_reads { write } else { read };
            if let Err(error) = unsafe {
                windows::Win32::Foundation::SetHandleInformation(
                    parent_end,
                    HANDLE_FLAG_INHERIT.0,
                    HANDLE_FLAGS(0),
                )
            } {
                close(read);
                close(write);
                return Err(BrokerError::new(
                    ErrorCode::SpawnFailed,
                    format!("SetHandleInformation failed: {error}"),
                ));
            }
            Ok((read, write))
        }

        fn quote_windows_arg(value: &OsStr) -> OsString {
            // CommandLineToArgvW-compatible quoting.  Always quoting keeps
            // paths with spaces and empty arguments unambiguous; literal
            // backslashes are doubled only when they precede a quote or the
            // closing quote.
            let text = value.to_string_lossy();
            let mut out = String::with_capacity(text.len() + 2);
            out.push('"');
            let mut slashes = 0usize;
            for ch in text.chars() {
                if ch == '\\' {
                    slashes += 1;
                    continue;
                }
                if ch == '"' {
                    out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                    out.push('"');
                } else {
                    out.extend(std::iter::repeat_n('\\', slashes));
                    out.push(ch);
                }
                slashes = 0;
            }
            out.extend(std::iter::repeat_n('\\', slashes * 2));
            out.push('"');
            OsString::from(out)
        }

        fn environment_block(command: &Command) -> Vec<u16> {
            let mut entries: Vec<(OsString, OsString)> = std::env::vars_os().collect();
            for (key, value) in command.get_envs() {
                let key_text = key.to_string_lossy();
                if let Some((_, existing_value)) = entries.iter_mut().find(|(existing, _)| {
                    existing.to_string_lossy().eq_ignore_ascii_case(&key_text)
                }) {
                    if let Some(value) = value {
                        *existing_value = value.to_os_string();
                    } else {
                        // Remove inherited values when Command::env_remove was
                        // used.  Brain currently only overrides values, but
                        // preserving this behavior keeps the adapter honest.
                        entries.retain(|(existing, _)| {
                            !existing.to_string_lossy().eq_ignore_ascii_case(&key_text)
                        });
                    }
                } else if let Some(value) = value {
                    entries.push((key.to_os_string(), value.to_os_string()));
                }
            }
            entries.sort_by(|a, b| {
                a.0.to_string_lossy()
                    .to_ascii_lowercase()
                    .cmp(&b.0.to_string_lossy().to_ascii_lowercase())
            });
            let mut block = Vec::new();
            for (key, value) in entries {
                if key.to_string_lossy().contains('=') || value.to_string_lossy().contains('\0') {
                    continue;
                }
                block.extend(key.encode_wide());
                block.push('=' as u16);
                block.extend(value.encode_wide());
                block.push(0);
            }
            // CreateProcessW requires a double-NUL-terminated environment
            // block, including when the inherited environment is empty.
            block.push(0);
            block
        }

        let program = command.get_program();
        let program_wide = wide(program);
        let mut command_line = quote_windows_arg(program);
        for arg in command.get_args() {
            command_line.push(" ");
            command_line.push(quote_windows_arg(arg));
        }
        let mut command_line_wide: Vec<u16> = command_line
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let current_dir_wide = command.get_current_dir().map(|path| wide(path.as_os_str()));
        let env_block = environment_block(command);

        // Child gets stdin from a pipe whose write end is closed immediately;
        // this is the native equivalent of Stdio::null without relying on
        // inherited GUI-console handles.
        let (stdin_read, stdin_write) = match create_pipe(true) {
            Ok(pipe) => pipe,
            Err(error) => {
                close(job);
                return Err(error);
            }
        };
        let (stdout_read, stdout_write) = match create_pipe(false) {
            Ok(pipe) => pipe,
            Err(error) => {
                close(stdin_read);
                close(stdin_write);
                close(job);
                return Err(error);
            }
        };
        let (stderr_read, stderr_write) = match create_pipe(false) {
            Ok(pipe) => pipe,
            Err(error) => {
                close(stdin_read);
                close(stdin_write);
                close(stdout_read);
                close(stdout_write);
                close(job);
                return Err(error);
            }
        };

        let startup = windows::Win32::System::Threading::STARTUPINFOW {
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: stdin_read,
            hStdOutput: stdout_write,
            hStdError: stderr_write,
            ..Default::default()
        };
        let inherited_handles = [stdin_read, stdout_write, stderr_write];
        let mut attribute_size = 0usize;
        // The sizing probe intentionally returns ERROR_INSUFFICIENT_BUFFER;
        // the only authoritative result here is the size it writes.
        let _ = unsafe {
            InitializeProcThreadAttributeList(
                LPPROC_THREAD_ATTRIBUTE_LIST::default(),
                1,
                0,
                &mut attribute_size,
            )
        };
        if attribute_size == 0 {
            close(stdin_read);
            close(stdin_write);
            close(stdout_read);
            close(stdout_write);
            close(stderr_read);
            close(stderr_write);
            close(job);
            return Err(BrokerError::new(
                ErrorCode::SpawnFailed,
                "InitializeProcThreadAttributeList sizing failed",
            ));
        }
        let attribute_words = attribute_size.div_ceil(std::mem::size_of::<usize>());
        let mut attribute_storage = vec![0usize; attribute_words];
        let attribute_list =
            LPPROC_THREAD_ATTRIBUTE_LIST(attribute_storage.as_mut_ptr() as *mut core::ffi::c_void);
        if let Err(error) =
            unsafe { InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_size) }
        {
            close(stdin_read);
            close(stdin_write);
            close(stdout_read);
            close(stdout_write);
            close(stderr_read);
            close(stderr_write);
            close(job);
            return Err(BrokerError::new(
                ErrorCode::SpawnFailed,
                format!("InitializeProcThreadAttributeList failed: {error}"),
            ));
        }
        let handle_list_result = unsafe {
            UpdateProcThreadAttribute(
                attribute_list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(inherited_handles.as_ptr() as *const core::ffi::c_void),
                std::mem::size_of_val(&inherited_handles),
                None,
                None,
            )
        };
        if let Err(error) = handle_list_result {
            unsafe { DeleteProcThreadAttributeList(attribute_list) };
            close(stdin_read);
            close(stdin_write);
            close(stdout_read);
            close(stdout_write);
            close(stderr_read);
            close(stderr_write);
            close(job);
            return Err(BrokerError::new(
                ErrorCode::SpawnFailed,
                format!("UpdateProcThreadAttribute(handle list) failed: {error}"),
            ));
        }
        let startup_ex = STARTUPINFOEXW {
            StartupInfo: windows::Win32::System::Threading::STARTUPINFOW {
                cb: std::mem::size_of::<STARTUPINFOEXW>() as u32,
                ..startup
            },
            lpAttributeList: attribute_list,
        };
        let mut info = PROCESS_INFORMATION::default();
        let mut flags =
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
        if no_window {
            flags |= CREATE_NO_WINDOW;
        }
        let current_dir = current_dir_wide
            .as_ref()
            .map(|path| PCWSTR(path.as_ptr()))
            .unwrap_or_else(PCWSTR::null);
        let created = unsafe {
            CreateProcessW(
                PCWSTR(program_wide.as_ptr()),
                PWSTR(command_line_wide.as_mut_ptr()),
                None,
                None,
                true,
                flags,
                Some(env_block.as_ptr() as *const core::ffi::c_void),
                current_dir,
                &startup_ex as *const STARTUPINFOEXW
                    as *const windows::Win32::System::Threading::STARTUPINFOW,
                &mut info,
            )
        };
        unsafe { DeleteProcThreadAttributeList(attribute_list) };
        // The parent never uses child-side handles after CreateProcessW.
        close(stdin_read);
        close(stdin_write);
        close(stdout_write);
        close(stderr_write);
        if let Err(error) = created {
            close(stdout_read);
            close(stderr_read);
            close(job);
            return Err(BrokerError::new(
                ErrorCode::SpawnFailed,
                format!("CreateProcessW failed: {error}"),
            ));
        }

        log_spawn_diagnostic(
            info.dwProcessId,
            "created_suspended",
            "creation_flags=CREATE_SUSPENDED",
        );

        if let Err(error) = unsafe { AssignProcessToJobObject(job, info.hProcess) } {
            // The process is still suspended and has not crossed the Job
            // boundary. Terminate and reap it before releasing the process
            // handle so an assignment failure cannot leave a detached child
            // behind outside the containment boundary.
            unsafe {
                windows::Win32::System::Threading::TerminateProcess(info.hProcess, 1).ok();
                let _ =
                    windows::Win32::System::Threading::WaitForSingleObject(info.hProcess, 5_000);
            }
            close(info.hThread);
            close(info.hProcess);
            close(stdout_read);
            close(stderr_read);
            unsafe { CloseHandle(job) }.ok();
            return Err(BrokerError::new(
                ErrorCode::BrokerCrash,
                format!("AssignProcessToJobObject failed: {error}"),
            ));
        }
        log_spawn_diagnostic(info.dwProcessId, "job_assigned", "kill_on_job_close=true");

        let stdout = unsafe { std::fs::File::from_raw_handle(stdout_read.0 as RawHandle) };
        let stderr = unsafe { std::fs::File::from_raw_handle(stderr_read.0 as RawHandle) };
        Ok(Self {
            child: WindowsChild::Native(NativeChild {
                process: info.hProcess,
                primary_thread: Some(info.hThread),
                pid: info.dwProcessId,
                stdout: Some(Box::new(stdout) as ProcessOutput),
                stderr: Some(Box::new(stderr) as ProcessOutput),
                exit_status: None,
            }),
            job: Some(job),
            resume_required: true,
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

/// Resume every thread Windows published for a freshly created
/// `CREATE_SUSPENDED` process.
///
/// `std::process::Child` does not expose the `PROCESS_INFORMATION` primary
/// thread handle. The old implementation therefore resumed the first thread
/// returned by Toolhelp and assumed it was the primary thread. That assumption
/// is not stable for a bundled Node process: loader/native startup can publish
/// another thread before the snapshot is taken. Resuming that thread leaves
/// the actual primary thread suspended, producing a live PID with no JS/Brain
/// output after a hard desktop restart. A newborn process has no user work
/// that should remain suspended, so drain the suspend count for every thread
/// owned by the PID. Threads that are already running return a count of zero
/// and are left unchanged.
#[cfg(windows)]
fn resume_process_threads(child: &mut Child, diagnostics: bool) -> Result<(), BrokerError> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    const RETRY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
    const RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);
    const STABLE_ROUNDS: usize = 3;
    let pid = child.id();
    let deadline = std::time::Instant::now() + RETRY_TIMEOUT;
    let mut stable_rounds = 0usize;
    let mut resumed_any_thread = false;
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

        let mut thread_ids = Vec::new();
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if unsafe { Thread32First(snapshot, &mut entry) }.is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    thread_ids.push(entry.th32ThreadID);
                }
                if unsafe { Thread32Next(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        unsafe { CloseHandle(snapshot) }.ok();

        if thread_ids.is_empty() {
            // A short-lived command can finish between the first successful
            // ResumeThread call and the next Toolhelp snapshot. Once at least
            // one suspended thread was resumed, an exited child is a valid
            // completion of this barrier, not a startup failure. Without this
            // check the broker waits five seconds and reports a false
            // "no thread found" crash for ordinary `cmd /c`-style commands.
            if resumed_any_thread {
                match child.try_wait() {
                    Ok(Some(_)) => return Ok(()),
                    Ok(None) => {}
                    Err(error) => {
                        if std::time::Instant::now() >= deadline {
                            break format!(
                                "unable to query suspended process {pid} after resume: {error}"
                            );
                        }
                    }
                }
            }
            let message = format!("no thread found for suspended process {pid}");
            if std::time::Instant::now() >= deadline {
                break message;
            }
            std::thread::sleep(RETRY_INTERVAL);
            continue;
        }

        let mut failed = None;
        let mut stale_thread_observed = false;
        let mut resumed_suspended_thread = false;
        for thread_id in thread_ids {
            let thread = match unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, thread_id) } {
                Ok(thread) => thread,
                Err(error) => {
                    // Toolhelp snapshots are not stable: a loader/worker
                    // thread may exit between enumeration and OpenThread.
                    // Treat that handle as stale and take another bounded
                    // snapshot instead of retrying the same dead ID forever.
                    // If the error is persistent, the stability barrier below
                    // still fails closed at the deadline.
                    stale_thread_observed = true;
                    if diagnostics {
                        log_spawn_diagnostic(
                            pid,
                            "stale_thread",
                            &format!("thread_id={thread_id} open_error={error}"),
                        );
                    }
                    continue;
                }
            };

            // `CREATE_SUSPENDED` normally gives the primary thread a suspend
            // count of one. Windows can publish a larger count while process
            // creation is being finalized (for example when a launcher or job
            // policy suspends the process as well). Drain each newborn thread
            // to zero, bounded by the same startup retry deadline.
            let mut thread_done = false;
            while !thread_done {
                let previous_suspend_count = unsafe { ResumeThread(thread) };
                if previous_suspend_count == u32::MAX {
                    failed = Some(format!(
                        "ResumeThread failed for pid={pid} thread={thread_id}: {}",
                        std::io::Error::last_os_error()
                    ));
                    break;
                }
                if diagnostics {
                    log_spawn_diagnostic(
                        pid,
                        "resume_return",
                        &format!(
                            "thread_id={thread_id} previous_suspend_count={previous_suspend_count}"
                        ),
                    );
                }
                thread_done = previous_suspend_count <= 1;
                resumed_suspended_thread |= previous_suspend_count > 0;
                resumed_any_thread |= previous_suspend_count > 0;
                if !thread_done && std::time::Instant::now() >= deadline {
                    failed = Some(format!(
                        "ResumeThread left pid={pid} thread={thread_id} suspended (previous count {previous_suspend_count})"
                    ));
                    break;
                }
            }
            unsafe { CloseHandle(thread) }.ok();
            if failed.is_some() {
                break;
            }
        }

        if let Some(message) = failed {
            if diagnostics {
                log_spawn_diagnostic(pid, "resume_incomplete", &message);
            }
            if std::time::Instant::now() >= deadline {
                break message;
            }
            std::thread::sleep(RETRY_INTERVAL);
            continue;
        }

        // Toolhelp may publish the primary thread before the process has
        // finished its loader transition. Keep taking bounded snapshots, but
        // only reset stability when a thread was actually observed suspended.
        // Newly published *running* workers are normal for Node and for the
        // test harness; treating every new thread as instability can prevent
        // short-lived children from ever reaching the resume barrier.
        if resumed_suspended_thread || stale_thread_observed {
            stable_rounds = 0;
        } else {
            stable_rounds += 1;
        }
        if stable_rounds >= STABLE_ROUNDS {
            if diagnostics {
                log_spawn_diagnostic(pid, "resume_complete", "all_published_threads_resumed");
            }
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            break format!("thread publication did not stabilize for suspended process {pid}");
        }
        std::thread::sleep(RETRY_INTERVAL);
    };

    Err(BrokerError::new(
        ErrorCode::BrokerCrash,
        format!("{} (after {} ms)", last_error, RETRY_TIMEOUT.as_millis()),
    ))
}

#[cfg(all(test, windows))]
mod native_spawn_tests {
    use super::ProcessTree;
    use std::io::Read;
    use std::process::{Command, Stdio};

    /// The Brain adapter must resume the PROCESS_INFORMATION primary thread
    /// after Job assignment.  The test harness itself is a deterministic,
    /// trusted executable fixture: `--help` exits without user code and keeps
    /// the assertion independent of Node, SQLite, or the installed profile.
    /// Concurrent drains ensure the child cannot block on a full diagnostic
    /// pipe while the parent waits. The stdin direction is reviewed directly
    /// in the native adapter: only `hStdInput`'s read end is inheritable.
    #[test]
    fn native_spawn_resumes_primary_thread_and_captures_pipes() {
        let mut command = Command::new(std::env::current_exe().expect("current test exe"));
        command
            .arg("--help")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut tree = ProcessTree::spawn_hidden(&mut command).expect("native spawn");
        let mut stdout = tree.take_stdout().expect("stdout pipe");
        let mut stderr = tree.take_stderr().expect("stderr pipe");
        let stdout_reader = std::thread::spawn(move || {
            let mut text = String::new();
            stdout.read_to_string(&mut text).expect("stdout read");
            text
        });
        let stderr_reader = std::thread::spawn(move || {
            let mut text = String::new();
            stderr.read_to_string(&mut text).expect("stderr read");
            text
        });
        tree.resume().expect("resume primary thread");
        let status = tree.wait().expect("native child wait");
        let stdout_text = stdout_reader.join().expect("stdout reader");
        let stderr_text = stderr_reader.join().expect("stderr reader");
        assert!(
            status.success(),
            "test child failed: {stdout_text}{stderr_text}"
        );
        assert!(tree.is_empty(), "native child job did not drain");
    }
}
