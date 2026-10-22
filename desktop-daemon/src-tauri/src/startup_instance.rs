use std::io;

use tauri::{plugin::TauriPlugin, Manager};

#[cfg(windows)]
type InstanceGuard = std::os::windows::io::OwnedHandle;
#[cfg(unix)]
type InstanceGuard = std::fs::File;
#[cfg(not(any(windows, unix)))]
type InstanceGuard = ();

pub struct StartupInstanceGate {
    primary: bool,
    // Keeping the kernel mutex/file lock alive establishes the process lease.
    _guard: Option<InstanceGuard>,
}

impl StartupInstanceGate {
    pub fn is_primary(&self) -> bool {
        self.primary
    }
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("startup-instance-gate")
        .setup(|app| {
            let gate = acquire(app)?;
            app.manage(gate);
            Ok(())
        })
        .build()
}

#[cfg(windows)]
fn acquire(app: &tauri::AppHandle) -> io::Result<StartupInstanceGate> {
    use std::os::windows::io::FromRawHandle;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;

    let name = format!(
        "Local\\{}-startup-instance",
        app.config().tauri.bundle.identifier
    );
    let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe { CreateMutexW(None, false, PCWSTR(name_wide.as_ptr())) };
    let last_error = io::Error::last_os_error().raw_os_error();
    let handle = result.map_err(io::Error::other)?;
    let primary = last_error != Some(ERROR_ALREADY_EXISTS.0 as i32);
    if !primary {
        unsafe { CloseHandle(handle) }.map_err(io::Error::other)?;
        return Ok(StartupInstanceGate {
            primary: false,
            _guard: None,
        });
    }

    let guard = unsafe { InstanceGuard::from_raw_handle(handle.0 as *mut _) };
    Ok(StartupInstanceGate {
        primary: true,
        _guard: Some(guard),
    })
}

#[cfg(unix)]
fn acquire(app: &tauri::AppHandle) -> io::Result<StartupInstanceGate> {
    use std::fs::{self, OpenOptions};
    use std::os::fd::AsRawFd;

    let app_data = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "app data directory unavailable"))?;
    fs::create_dir_all(&app_data)?;
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(app_data.join("omni-context.single-instance.lock"))?;
    let result = unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(StartupInstanceGate {
            primary: true,
            _guard: Some(lock_file),
        });
    }

    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EAGAIN) || error.raw_os_error() == Some(libc::EWOULDBLOCK)
    {
        Ok(StartupInstanceGate {
            primary: false,
            _guard: None,
        })
    } else {
        Err(error)
    }
}

#[cfg(not(any(windows, unix)))]
fn acquire(_app: &tauri::AppHandle) -> io::Result<StartupInstanceGate> {
    Ok(StartupInstanceGate {
        primary: true,
        _guard: None,
    })
}
