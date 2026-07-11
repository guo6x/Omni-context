use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u8 = 1;
const MAX_CLOCK_SKEW_SECONDS: i64 = 120;
const MAX_NONCES_PER_DEVICE: usize = 256;
const MIN_SECRET_BYTES: usize = 32;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareAction {
    Precipitate,
    Decision,
    Reset,
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedHardwareMessage {
    pub version: u8,
    pub device_id: String,
    pub action: HardwareAction,
    pub timestamp: i64,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub ip: Option<String>,
    pub last_seen: Option<String>,
    pub last_command: Option<String>,
    pub packets: u64,
    pub paired: bool,
    pub alias: Option<String>,
    pub key_version: u32,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredDevice {
    device_id: String,
    secret_hex: String,
    ip: Option<String>,
    last_seen: Option<String>,
    last_command: Option<String>,
    packets: u64,
    paired: bool,
    alias: Option<String>,
    key_version: u32,
    revoked_at: Option<String>,
    #[serde(default)]
    recent_nonces: VecDeque<String>,
}

impl From<&StoredDevice> for DeviceInfo {
    fn from(device: &StoredDevice) -> Self {
        Self {
            device_id: device.device_id.clone(),
            ip: device.ip.clone(),
            last_seen: device.last_seen.clone(),
            last_command: device.last_command.clone(),
            packets: device.packets,
            paired: device.paired,
            alias: device.alias.clone(),
            key_version: device.key_version,
            revoked_at: device.revoked_at.clone(),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    version: u8,
    devices: HashMap<String, StoredDevice>,
}

#[derive(Debug, Default)]
struct RegistryState {
    path: Option<PathBuf>,
    data: RegistryFile,
}

static REGISTRY: LazyLock<Mutex<RegistryState>> =
    LazyLock::new(|| Mutex::new(RegistryState::default()));

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn current_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn validate_device_id(device_id: &str) -> Result<(), String> {
    let valid = (8..=128).contains(&device_id.len())
        && device_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'));
    if valid {
        Ok(())
    } else {
        Err("device_id must be 8-128 ASCII letters, digits, '-', '_' or ':'".to_string())
    }
}

fn decode_secret(secret_hex: &str) -> Result<Vec<u8>, String> {
    let secret =
        hex::decode(secret_hex).map_err(|_| "credential must be hexadecimal".to_string())?;
    if secret.len() < MIN_SECRET_BYTES {
        return Err(format!(
            "credential must contain at least {MIN_SECRET_BYTES} bytes"
        ));
    }
    Ok(secret)
}

fn canonical_payload(message: &SignedHardwareMessage) -> String {
    let action = match message.action {
        HardwareAction::Precipitate => "precipitate",
        HardwareAction::Decision => "decision",
        HardwareAction::Reset => "reset",
        HardwareAction::Heartbeat => "heartbeat",
    };
    format!(
        "{}|{}|{}|{}|{}",
        message.version, message.device_id, action, message.timestamp, message.nonce
    )
}

fn verify_signature(secret: &[u8], message: &SignedHardwareMessage) -> Result<(), String> {
    let signature =
        hex::decode(&message.signature).map_err(|_| "signature must be hexadecimal".to_string())?;
    let mut mac =
        HmacSha256::new_from_slice(secret).map_err(|_| "invalid device credential".to_string())?;
    mac.update(canonical_payload(message).as_bytes());
    mac.verify_slice(&signature)
        .map_err(|_| "invalid message signature".to_string())
}

fn persist(state: &RegistryState) -> Result<(), String> {
    let Some(path) = &state.path else {
        return Err("hardware registry is not initialized".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create registry directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(&state.data)
        .map_err(|error| format!("serialize hardware registry: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("write hardware registry: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("replace hardware registry: {error}"))?;
    Ok(())
}

pub fn initialize_registry(path: PathBuf) -> Result<(), String> {
    let data = if path.exists() {
        let bytes = fs::read(&path).map_err(|error| format!("read hardware registry: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse hardware registry: {error}"))?
    } else {
        RegistryFile {
            version: PROTOCOL_VERSION,
            devices: HashMap::new(),
        }
    };
    let mut state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    state.path = Some(path);
    state.data = data;
    Ok(())
}

pub fn verify_packet(packet: &[u8], ip: &str) -> Result<HardwareAction, String> {
    verify_packet_at(packet, ip, now_epoch_seconds())
}

fn verify_packet_at(packet: &[u8], ip: &str, now: i64) -> Result<HardwareAction, String> {
    if packet.len() > 2048 {
        return Err("hardware packet is too large".to_string());
    }
    let message: SignedHardwareMessage =
        serde_json::from_slice(packet).map_err(|_| "invalid hardware packet JSON".to_string())?;
    if message.version != PROTOCOL_VERSION {
        return Err("unsupported hardware protocol version".to_string());
    }
    validate_device_id(&message.device_id)?;
    if !(16..=128).contains(&message.nonce.len())
        || !message.nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("nonce must be 16-128 hexadecimal characters".to_string());
    }
    if now.abs_diff(message.timestamp) > MAX_CLOCK_SKEW_SECONDS as u64 {
        return Err("hardware packet timestamp is outside the accepted window".to_string());
    }

    let mut state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let device = state
        .data
        .devices
        .get_mut(&message.device_id)
        .ok_or_else(|| "unknown hardware device".to_string())?;
    if !device.paired || device.revoked_at.is_some() {
        return Err("hardware device is not paired or has been revoked".to_string());
    }
    if device.recent_nonces.contains(&message.nonce) {
        return Err("replayed hardware packet".to_string());
    }
    let secret = decode_secret(&device.secret_hex)?;
    verify_signature(&secret, &message)?;

    device.ip = Some(ip.to_string());
    device.last_seen = Some(current_iso8601());
    device.last_command = Some(
        canonical_payload(&message)
            .split('|')
            .nth(2)
            .unwrap_or("")
            .to_string(),
    );
    device.packets = device.packets.saturating_add(1);
    device.recent_nonces.push_back(message.nonce);
    while device.recent_nonces.len() > MAX_NONCES_PER_DEVICE {
        device.recent_nonces.pop_front();
    }
    let action = message.action;
    persist(&state)?;
    Ok(action)
}

fn normalize_alias(alias: Option<String>) -> Option<String> {
    alias.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.chars().take(64).collect())
        }
    })
}

#[tauri::command]
pub fn list_hardware_devices() -> Vec<DeviceInfo> {
    let state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut devices: Vec<DeviceInfo> = state.data.devices.values().map(DeviceInfo::from).collect();
    devices.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    devices
}

#[tauri::command]
pub fn pair_hardware_device(
    device_id: String,
    credential: String,
    alias: Option<String>,
) -> Result<(), String> {
    validate_device_id(&device_id)?;
    decode_secret(&credential)?;
    let mut state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = state.data.devices.get(&device_id).cloned();
    let key_version = previous
        .as_ref()
        .map_or(1, |device| device.key_version.saturating_add(1));
    state.data.devices.insert(
        device_id.clone(),
        StoredDevice {
            device_id,
            secret_hex: credential.to_ascii_lowercase(),
            ip: previous.as_ref().and_then(|device| device.ip.clone()),
            last_seen: previous
                .as_ref()
                .and_then(|device| device.last_seen.clone()),
            last_command: previous
                .as_ref()
                .and_then(|device| device.last_command.clone()),
            packets: previous.as_ref().map_or(0, |device| device.packets),
            paired: true,
            alias: normalize_alias(alias).or_else(|| previous.and_then(|device| device.alias)),
            key_version,
            revoked_at: None,
            recent_nonces: VecDeque::new(),
        },
    );
    persist(&state)
}

#[tauri::command]
pub fn unpair_hardware_device(device_id: String) -> Result<(), String> {
    let mut state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let device = state
        .data
        .devices
        .get_mut(&device_id)
        .ok_or_else(|| format!("device {device_id} does not exist"))?;
    device.paired = false;
    device.revoked_at = Some(current_iso8601());
    persist(&state)
}

#[tauri::command]
pub fn forget_hardware_device(device_id: String) -> Result<(), String> {
    let mut state = REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.data.devices.remove(&device_id).is_none() {
        return Err(format!("device {device_id} does not exist"));
    }
    persist(&state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(1);
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn signed_message(secret: &[u8], timestamp: i64, nonce: &str) -> SignedHardwareMessage {
        let mut message = SignedHardwareMessage {
            version: 1,
            device_id: "esp32-test-0001".to_string(),
            action: HardwareAction::Precipitate,
            timestamp,
            nonce: nonce.to_string(),
            signature: String::new(),
        };
        let mut mac = HmacSha256::new_from_slice(secret).unwrap();
        mac.update(canonical_payload(&message).as_bytes());
        message.signature = hex::encode(mac.finalize().into_bytes());
        message
    }

    fn setup_registry(secret: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "omni-hardware-test-{}-{}-{}.json",
            std::process::id(),
            now_epoch_seconds(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&path);
        initialize_registry(path.clone()).unwrap();
        pair_hardware_device(
            "esp32-test-0001".to_string(),
            hex::encode(secret),
            Some("test".to_string()),
        )
        .unwrap();
        path
    }

    #[test]
    fn accepts_signed_packet_and_rejects_replay() {
        let _guard = TEST_LOCK.lock().unwrap();
        let secret = [7_u8; 32];
        let path = setup_registry(&secret);
        let now = now_epoch_seconds();
        let message = signed_message(&secret, now, "0011223344556677");
        let bytes = serde_json::to_vec(&message).unwrap();
        assert_eq!(
            verify_packet_at(&bytes, "192.0.2.10", now).unwrap(),
            HardwareAction::Precipitate
        );
        initialize_registry(path.clone()).unwrap();
        assert_eq!(
            verify_packet_at(&bytes, "192.0.2.10", now).unwrap_err(),
            "replayed hardware packet"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_bad_signature_expired_and_revoked_packets() {
        let _guard = TEST_LOCK.lock().unwrap();
        let secret = [9_u8; 32];
        let path = setup_registry(&secret);
        let now = now_epoch_seconds();

        let mut unknown = signed_message(&secret, now, "0000111122223333");
        unknown.device_id = "esp32-unknown-0001".to_string();
        assert_eq!(
            verify_packet_at(&serde_json::to_vec(&unknown).unwrap(), "192.0.2.10", now)
                .unwrap_err(),
            "unknown hardware device"
        );

        let mut bad = signed_message(&secret, now, "1111222233334444");
        bad.signature.replace_range(0..2, "00");
        assert_eq!(
            verify_packet_at(&serde_json::to_vec(&bad).unwrap(), "192.0.2.10", now).unwrap_err(),
            "invalid message signature"
        );

        let expired = signed_message(
            &secret,
            now - MAX_CLOCK_SKEW_SECONDS - 1,
            "5555666677778888",
        );
        assert!(
            verify_packet_at(&serde_json::to_vec(&expired).unwrap(), "192.0.2.10", now)
                .unwrap_err()
                .contains("timestamp")
        );

        unpair_hardware_device("esp32-test-0001".to_string()).unwrap();
        let revoked = signed_message(&secret, now, "9999aaaabbbbcccc");
        assert!(
            verify_packet_at(&serde_json::to_vec(&revoked).unwrap(), "192.0.2.10", now)
                .unwrap_err()
                .contains("revoked")
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn registry_survives_reload_without_exposing_credentials() {
        let _guard = TEST_LOCK.lock().unwrap();
        let secret = [11_u8; 32];
        let path = setup_registry(&secret);
        initialize_registry(path.clone()).unwrap();
        let devices = list_hardware_devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_id, "esp32-test-0001");
        assert_eq!(devices[0].key_version, 1);
        let serialized = serde_json::to_string(&devices).unwrap();
        assert!(!serialized.contains(&hex::encode(secret)));
        let _ = fs::remove_file(path);
    }
}
