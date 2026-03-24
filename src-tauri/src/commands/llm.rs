use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use std::sync::atomic::{AtomicBool, Ordering};

static ABORT_LLM: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn abort_llm() {
    ABORT_LLM.store(true, Ordering::SeqCst);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
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

/// Base system prompt — always included.
const BASE_SYSTEM_PROMPT: &str = r#"You are a code editor AI assistant. The user may write instructions in any language (English, Turkish, etc.) — always understand and apply them.

Your ONLY output must be the complete, modified source file. Never write explanations. Never say "I cannot". Always make the best possible improvement based on the instruction.

CRITICAL OUTPUT RULES:
- Output the ENTIRE file from line 1 to the last line. Never truncate or skip lines.
- If the instruction is vague (e.g. "improve", "clean up", "yapıyı geliştir"), make reasonable improvements: fix naming, add missing error handling, improve readability, extract repeated code into functions, etc.
- Do NOT output any explanation, comments about what you changed, or markdown.
- Do NOT wrap output in ```code fences``` or any other formatting.
- Copy every unchanged line EXACTLY as-is, character by character.
- Your first character of output must be the first character of the file.
- Your last character of output must be the last character of the file.
- Preserve all whitespace, indentation, and line endings exactly."#;

/// Detect the task type from user prompt keywords and return specific instructions.
fn detect_task_guidance(prompt: &str) -> &'static str {
    let p = prompt.to_lowercase();

    if p.contains("refactor") || p.contains("clean") || p.contains("reorganize") {
        return "TASK: Refactoring. Preserve all functionality exactly. Only restructure code style/organization. Do not change variable names unless asked.";
    }
    if p.contains("bug") || p.contains("fix") || p.contains("error") || p.contains("crash") || p.contains("broken") {
        return "TASK: Bug fix. Make the minimal targeted change to fix the described issue. Do not touch unrelated code.";
    }
    if p.contains("add") || p.contains("implement") || p.contains("create") || p.contains("new") {
        return "TASK: Adding functionality. Insert new code at the correct location. Do not modify existing logic unless necessary for integration.";
    }
    if p.contains("remove") || p.contains("delete") || p.contains("drop") {
        return "TASK: Removing code. Delete only what was requested. Check that removing it does not break imports or usages, and remove those too if necessary.";
    }
    if p.contains("rename") || p.contains("move") {
        return "TASK: Renaming/moving. Update every occurrence of the renamed symbol throughout the file consistently.";
    }
    if p.contains("comment") || p.contains("document") || p.contains("docstring") || p.contains("jsdoc") {
        return "TASK: Documentation. Add concise, accurate comments/docstrings. Do not alter any logic.";
    }
    if p.contains("type") || p.contains("interface") || p.contains("annotation") {
        return "TASK: Type improvements. Add or fix type annotations without changing runtime behavior.";
    }
    if p.contains("test") || p.contains("spec") || p.contains("unit test") {
        return "TASK: Test writing. Write focused, isolated tests that cover the described scenarios.";
    }
    if p.contains("optimize") || p.contains("performance") || p.contains("speed") || p.contains("faster") {
        return "TASK: Performance optimization. Make targeted improvements. Preserve correctness and all edge cases.";
    }
    if p.contains("format") || p.contains("indent") || p.contains("style") || p.contains("lint") {
        return "TASK: Code formatting. Apply consistent formatting. Do not change any logic or names.";
    }

    "TASK: General edit. Apply the described changes minimally and precisely."
}

/// Return language-specific best practices to guide the model.
fn language_guidance(file_path: &str) -> &'static str {
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "rs" => "LANGUAGE: Rust. Use idiomatic Rust: ownership, Result/Option types, match patterns. Avoid unwrap() in library code. Prefer ? operator.",
        "ts" | "tsx" => "LANGUAGE: TypeScript. Maintain strict typing. Prefer interfaces over type aliases for object shapes. Avoid 'any'. Use functional React patterns with hooks.",
        "js" | "jsx" => "LANGUAGE: JavaScript. Use modern ES2022+ syntax. Prefer const/let over var. Use arrow functions. Avoid mutation of shared state.",
        "py" => "LANGUAGE: Python. Follow PEP8. Use type hints. Prefer list/dict comprehensions where readable. Use f-strings for formatting.",
        "go" => "LANGUAGE: Go. Follow Go conventions: short variable names, explicit error handling, idiomatic interfaces. Never ignore errors.",
        "java" => "LANGUAGE: Java. Follow Java conventions. Use generics appropriately. Prefer composition over inheritance.",
        "cpp" | "cc" | "cxx" => "LANGUAGE: C++. Use modern C++17/20 features. Prefer smart pointers. Avoid raw pointers and manual memory management.",
        "c" => "LANGUAGE: C. Be explicit about memory management. Check all return values. Avoid buffer overflows.",
        "swift" => "LANGUAGE: Swift. Use optionals properly. Prefer value types. Follow Swift API design guidelines.",
        "kt" | "kts" => "LANGUAGE: Kotlin. Use Kotlin idioms: data classes, extension functions, null safety operators.",
        "css" | "scss" | "sass" => "LANGUAGE: CSS. Maintain existing class naming convention. Keep specificity low. Preserve all existing rules not being changed.",
        "html" => "LANGUAGE: HTML. Maintain semantic structure. Keep accessibility attributes. Preserve indentation style.",
        "json" | "toml" | "yaml" | "yml" => "LANGUAGE: Config file. Maintain exact formatting and schema structure. Validate that the result is syntactically valid.",
        "sh" | "bash" | "zsh" => "LANGUAGE: Shell script. Quote all variable expansions. Handle errors with set -e or explicit checks.",
        _ => "",
    }
}

/// Analyze file structure to give the model useful context.
fn analyze_file_context(content: &str, file_path: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let line_count = lines.len();

    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();

    let mut ctx_parts: Vec<String> = Vec::new();
    ctx_parts.push(format!("Total lines: {}", line_count));

    // Detect imports/dependencies section
    let import_count = lines
        .iter()
        .filter(|l| {
            let t = l.trim_start();
            t.starts_with("import ")
                || t.starts_with("use ")
                || t.starts_with("from ")
                || t.starts_with("#include")
                || t.starts_with("require(")
        })
        .count();
    if import_count > 0 {
        ctx_parts.push(format!("Imports/uses: {}", import_count));
    }

    // Detect functions/methods
    let fn_count = match ext.as_str() {
        "rs" => lines
            .iter()
            .filter(|l| {
                let t = l.trim_start();
                t.starts_with("pub fn ") || t.starts_with("fn ") || t.starts_with("async fn ")
            })
            .count(),
        "ts" | "tsx" | "js" | "jsx" => lines
            .iter()
            .filter(|l| {
                let t = l.trim_start();
                t.contains("function ") || t.contains("=> {") || t.contains("=> (")
            })
            .count(),
        "py" => lines
            .iter()
            .filter(|l| l.trim_start().starts_with("def ") || l.trim_start().starts_with("async def "))
            .count(),
        "go" => lines
            .iter()
            .filter(|l| l.trim_start().starts_with("func "))
            .count(),
        _ => 0,
    };
    if fn_count > 0 {
        ctx_parts.push(format!("Functions/methods: {}", fn_count));
    }

    ctx_parts.join(", ")
}

#[derive(Debug, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn stream_llm(
    app: AppHandle,
    provider: String,
    base_url: String,
    model: String,
    file_content: String,
    file_path: String,
    user_prompt: String,
    history: Option<Vec<HistoryMessage>>,
    partial_assistant: Option<String>,
) -> Result<(), String> {
    let numbered: String = file_content
        .lines()
        .enumerate()
        .map(|(i, line)| format!("{:4} | {}", i + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    let line_count = file_content.lines().count();

    // Build enhanced system prompt
    let task_guidance = detect_task_guidance(&user_prompt);
    let lang_guidance = language_guidance(&file_path);
    let file_ctx = analyze_file_context(&file_content, &file_path);

    let mut system_prompt = BASE_SYSTEM_PROMPT.to_string();

    if !lang_guidance.is_empty() {
        system_prompt.push_str("\n\n");
        system_prompt.push_str(lang_guidance);
    }

    system_prompt.push_str("\n\n");
    system_prompt.push_str(task_guidance);

    system_prompt.push_str(&format!(
        "\n\nFILE CONTEXT: {}",
        file_ctx
    ));

    let user_message = format!(
        "File: {} ({})\n\nCurrent file content (line numbers for reference only — do NOT include them in output):\n{}\n\n---\nInstruction: {}\n\nOutput the complete file ({} lines), modifying only what the instruction requires.",
        file_path, file_ctx, numbered, user_prompt, line_count
    );

    let mut messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
    ];

    // Inject conversation history so the model remembers prior edits
    if let Some(hist) = history {
        for msg in hist {
            messages.push(ChatMessage {
                role: msg.role,
                content: msg.content,
            });
        }
    }

    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_message,
    });

    let mut full_content = String::new();

    // If resuming from a pause, inject the partial assistant message at the end
    // so the LLM continues from it. We also pre-seed full_content so the final diff is complete.
    if let Some(partial) = partial_assistant {
        messages.push(ChatMessage {
            role: "assistant".to_string(),
            content: partial.clone(),
        });
        full_content.push_str(&partial);
        // Send the partial back to UI immediately so it doesn't flicker
        app.emit("llm-chunk", partial).unwrap_or(());
    }

    let body = StreamRequest {
        model: model.clone(),
        messages,
        stream: true,
        temperature: 0.1,
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

    ABORT_LLM.store(false, Ordering::SeqCst);
    app.emit("llm-start", ()).map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        if ABORT_LLM.load(Ordering::SeqCst) {
            app.emit("llm-aborted", full_content.clone()).unwrap_or(());
            return Ok(());
        }

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
                let delta = val
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str());

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

    let clean = clean_model_output(&full_content);
    app.emit("llm-done", clean).map_err(|e| e.to_string())?;
    Ok(())
}

fn clean_model_output(s: &str) -> String {
    let s = strip_code_fences(s);
    let lines: Vec<&str> = s.lines().collect();
    let numbered_count = lines.iter().filter(|l| is_numbered_line(l)).count();
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
    while chars.peek() == Some(&' ') {
        chars.next();
    }
    chars.next() == Some('|')
}

fn strip_line_number(line: &str) -> &str {
    let t = line.trim_start();
    let mut idx = 0;
    let bytes = t.as_bytes();
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    while idx < bytes.len() && bytes[idx] == b' ' {
        idx += 1;
    }
    if idx < bytes.len() && bytes[idx] == b'|' {
        idx += 1;
    } else {
        return line;
    }
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
