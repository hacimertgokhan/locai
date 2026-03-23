use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command as SysCmd;

// ── Shared message type for agent conversations ────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionCall,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionCall {
    pub name: String,
    /// JSON string (OpenAI) OR JSON object (Ollama) — always normalised to string before storing
    pub arguments: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionDef,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

// ── Result types ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmStepResult {
    ToolCalls {
        tool_calls: Vec<ToolCall>,
        assistant_message: AgentMessage,
    },
    Content {
        content: String,
    },
}

// ── Helper: normalise a raw tool_call JSON value ──────────────────

fn normalise_tool_call(raw: &serde_json::Value, idx: usize) -> Option<ToolCall> {
    let func = raw.get("function")?;
    let name = func.get("name")?.as_str()?.to_string();

    // Ollama returns `arguments` as a JSON object; OpenAI returns it as a
    // JSON-encoded string.  We normalise to a string so the frontend always
    // receives a consistent shape.
    let arguments = match func.get("arguments") {
        Some(v) if v.is_string() => v.as_str().unwrap().to_string(),
        Some(v) => v.to_string(),
        None => "{}".to_string(),
    };

    // Ollama tool calls often don't have an `id` field.
    let id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(&format!("call_{}_{}", name, idx))
        .to_string();

    let kind = raw
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("function")
        .to_string();

    Some(ToolCall {
        id,
        kind,
        function: FunctionCall { name, arguments },
    })
}

// ── Single non-streaming LLM call with tool support ───────────────

#[tauri::command]
pub async fn call_llm_step(
    provider: String,
    base_url: String,
    model: String,
    messages: Vec<AgentMessage>,
    tools: Vec<ToolDef>,
) -> Result<LlmStepResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let url = if provider == "ollama" {
        format!("{}/api/chat", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))
    };

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "temperature": 0.2,
    });

    if !tools.is_empty() {
        body["tools"] = serde_json::to_value(&tools).map_err(|e| e.to_string())?;
    }

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Response parse failed: {}", e))?;

    // Unified message extraction (Ollama vs OpenAI)
    let message = if provider == "ollama" {
        json.get("message").cloned().unwrap_or(serde_json::Value::Null)
    } else {
        json.get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    };

    // Check for tool calls
    if let Some(arr) = message.get("tool_calls").and_then(|v| v.as_array()) {
        if !arr.is_empty() {
            let calls: Vec<ToolCall> = arr
                .iter()
                .enumerate()
                .filter_map(|(i, v)| normalise_tool_call(v, i))
                .collect();

            if !calls.is_empty() {
                let assistant_msg = AgentMessage {
                    role: "assistant".to_string(),
                    content: message.get("content").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    tool_calls: Some(calls.clone()),
                    tool_call_id: None,
                    name: None,
                };
                return Ok(LlmStepResult::ToolCalls {
                    tool_calls: calls,
                    assistant_message: assistant_msg,
                });
            }
        }
    }

    let content = message
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(LlmStepResult::Content { content })
}

// ── File / system tool commands ────────────────────────────────────

/// Create or overwrite a file (creates parent directories automatically).
#[tauri::command]
pub fn agent_write_file(path: String, content: String) -> Result<String, String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = content.len();
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(format!("Wrote {} bytes to {}", bytes, path))
}

/// Delete a file or directory (recursive for directories).
#[tauri::command]
pub fn agent_delete_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        Ok(format!("Deleted directory: {}", path))
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        Ok(format!("Deleted file: {}", path))
    }
}

/// Rename / move a file or directory.
#[tauri::command]
pub fn agent_rename_path(from: String, to: String) -> Result<String, String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(format!("Renamed {} → {}", from, to))
}

/// Create a directory (and all parents).
#[tauri::command]
pub fn agent_create_dir(path: String) -> Result<String, String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(format!("Created directory: {}", path))
}

/// Run an arbitrary shell command in `cwd`. Returns combined stdout + stderr.
#[tauri::command]
pub async fn agent_run_command(cwd: String, command: String) -> Result<String, String> {
    // Use a login shell so that nvm, npm, npx, etc. are on PATH
    let output = SysCmd::new("sh")
        .arg("-l")
        .arg("-c")
        .arg(&command)
        .current_dir(&cwd)
        .env("TERM", "dumb")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    let mut result = stdout.clone();
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&format!("[stderr] {}", stderr));
    }
    if code != 0 {
        result.push_str(&format!("\n[exit {}]", code));
    }
    if result.trim().is_empty() {
        Ok("(no output)".to_string())
    } else {
        // Cap at 8 KB to avoid flooding the context window
        Ok(result.chars().take(8192).collect())
    }
}
