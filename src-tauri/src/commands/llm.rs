use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub provider: String, // "ollama" | "lmstudio"
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAIModel {
    id: String,
}

#[tauri::command]
pub async fn list_ollama_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: OllamaTagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data
        .models
        .into_iter()
        .map(|m| ModelInfo {
            id: m.name,
            provider: "ollama".to_string(),
        })
        .collect())
}

#[tauri::command]
pub async fn list_lmstudio_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: OpenAIModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data
        .data
        .into_iter()
        .map(|m| ModelInfo {
            id: m.id,
            provider: "lmstudio".to_string(),
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    temperature: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

const SYSTEM_PROMPT: &str = r#"You are a code editor AI. Your ONLY job is to output the complete, modified source file.

CRITICAL RULES — violating any rule makes your output useless:
- Output the ENTIRE file from line 1 to the last line. Never truncate or skip lines.
- Make ONLY the minimal changes requested. Do not rewrite, reorganize, or remove unrelated code.
- Do NOT output any explanation, comments about what you changed, or markdown.
- Do NOT wrap output in ```code fences``` or any other formatting.
- Copy every unchanged line EXACTLY as-is, character by character.
- Your first character of output must be the first character of the file.
- Your last character of output must be the last character of the file.

If the file has 200 lines, your output must also have ~200 lines (±lines added or removed by the edit)."#;

#[tauri::command]
pub async fn stream_llm(
    app: AppHandle,
    provider: String,
    base_url: String,
    model: String,
    file_content: String,
    file_path: String,
    user_prompt: String,
) -> Result<(), String> {
    // Add line numbers so model understands the full scope of the file
    let numbered: String = file_content
        .lines()
        .enumerate()
        .map(|(i, line)| format!("{:4} | {}", i + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    let line_count = file_content.lines().count();

    let user_message = format!(
        "File: {} ({} lines)\n\nCurrent file content (with line numbers for reference — do NOT include line numbers in output):\n{}\n\n---\nInstruction: {}\n\nRemember: output the complete file ({} lines total), only modifying what the instruction asks for.",
        file_path, line_count, numbered, user_prompt, line_count
    );

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];

    let body = StreamRequest {
        model: model.clone(),
        messages,
        stream: true,
        temperature: 0.2,
    };

    let url = if provider == "ollama" {
        format!("{}/api/chat", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    let mut full_content = String::new();

    app.emit("llm-start", ()).map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);

        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            let json_str = if line.starts_with("data: ") {
                &line[6..]
            } else {
                line
            };

            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                // Try OpenAI format (LM Studio + Ollama /v1/)
                let delta = val
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str());

                // Try Ollama native format
                let ollama_content = val
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str());

                if let Some(content) = delta.or(ollama_content) {
                    if !content.is_empty() {
                        full_content.push_str(content);
                        app.emit("llm-chunk", content.to_string())
                            .map_err(|e| e.to_string())?;
                    }
                }

                // Check if done
                let done = val.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
                let finish_reason = val
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("finish_reason"))
                    .and_then(|f| f.as_str());

                if done || finish_reason == Some("stop") {
                    break;
                }
            }
        }
    }

    // Clean up model output
    let clean = clean_model_output(&full_content);
    app.emit("llm-done", clean).map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove markdown code fences AND line-number prefixes the model may have echoed back.
/// Handles patterns like: "  19 | code" or "19| code" or "19 |code"
fn clean_model_output(s: &str) -> String {
    let s = strip_code_fences(s);

    // Detect if the output contains line-number prefixes on most lines.
    // Pattern: optional whitespace, digits, optional whitespace, "|", optional space, rest
    let lines: Vec<&str> = s.lines().collect();
    let numbered_count = lines.iter().filter(|l| is_numbered_line(l)).count();

    // If more than 40% of non-empty lines have the prefix, strip them all
    let non_empty = lines.iter().filter(|l| !l.trim().is_empty()).count();
    if non_empty > 0 && numbered_count * 100 / non_empty >= 40 {
        return lines
            .iter()
            .map(|l| strip_line_number(l))
            .collect::<Vec<_>>()
            .join("\n");
    }

    s
}

fn is_numbered_line(line: &str) -> bool {
    let t = line.trim_start();
    // Match: digits followed by optional spaces and "|"
    let mut chars = t.chars().peekable();
    let mut has_digit = false;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            has_digit = true;
            chars.next();
        } else {
            break;
        }
    }
    if !has_digit {
        return false;
    }
    // Skip optional spaces
    while chars.peek() == Some(&' ') {
        chars.next();
    }
    chars.next() == Some('|')
}

fn strip_line_number(line: &str) -> &str {
    let t = line.trim_start();
    let mut idx = 0;
    let bytes = t.as_bytes();
    // Skip digits
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    // Skip spaces
    while idx < bytes.len() && bytes[idx] == b' ' {
        idx += 1;
    }
    // Skip '|'
    if idx < bytes.len() && bytes[idx] == b'|' {
        idx += 1;
    } else {
        // No pipe found — return original line untouched
        return line;
    }
    // Skip one optional space after pipe
    if idx < bytes.len() && bytes[idx] == b' ' {
        idx += 1;
    }
    &t[idx..]
}

fn strip_code_fences(s: &str) -> String {
    let trimmed = s.trim();
    if let Some(inner) = trimmed.strip_prefix("```") {
        let after_first_line = inner.find('\n').map(|i| &inner[i + 1..]).unwrap_or(inner);
        let without_end = after_first_line
            .trim_end()
            .trim_end_matches("```")
            .trim_end();
        return without_end.to_string();
    }
    trimmed.to_string()
}
