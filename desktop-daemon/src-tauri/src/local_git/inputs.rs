use serde::Deserialize;
use serde_json::{Map, Value};

const FULL_SHA_LEN: usize = 40;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitBranchCreateInput {
    pub repository_path: String,
    pub branch_name: String,
    pub start_point: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitBranchReadInput {
    pub repository_path: String,
    pub branch_name: String,
}

pub fn parse_create_inputs(inputs: &Map<String, Value>) -> Result<GitBranchCreateInput, String> {
    serde_json::from_value(Value::Object(inputs.clone()))
        .map_err(|_| "git.branch.create inputs must contain only repository_path, branch_name and start_point".to_string())
}

pub fn parse_read_inputs(inputs: &Map<String, Value>) -> Result<GitBranchReadInput, String> {
    serde_json::from_value(Value::Object(inputs.clone())).map_err(|_| {
        "git.branch.read inputs must contain only repository_path and branch_name".to_string()
    })
}

pub fn validate_branch_name(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 200 {
        return Err("branch_name length is outside the approved range".to_string());
    }
    if value.starts_with('-')
        || value.starts_with('/')
        || value.ends_with('/')
        || value.ends_with('.')
        || value.ends_with(".lock")
        || value.contains("..")
        || value.contains("//")
        || value.contains("@{")
    {
        return Err("branch_name is not a valid bounded Git ref name".to_string());
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/'))
    {
        return Err("branch_name contains unsupported or shell-significant characters".to_string());
    }
    Ok(value)
}

pub fn validate_start_point(value: &str) -> Result<&str, String> {
    if value.len() != FULL_SHA_LEN || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("start_point must be a full 40-hex commit SHA".to_string());
    }
    if value.chars().any(|ch| ch.is_ascii_uppercase()) {
        return Err("start_point must use lowercase canonical SHA text".to_string());
    }
    Ok(value)
}
