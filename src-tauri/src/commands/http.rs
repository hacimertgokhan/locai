use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
pub struct HttpRequestInput {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseOutput {
    pub ok: bool,
    pub status: u16,
    pub status_text: String,
    pub elapsed_ms: u128,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Serialize)]
pub struct DiscoveredEndpoint {
    pub method: String,
    pub path: String,
    pub file: String,
    pub line: usize,
}

#[tauri::command]
pub async fn http_request(input: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let method = reqwest::Method::from_bytes(input.method.trim().to_uppercase().as_bytes())
        .map_err(|_| "Invalid HTTP method".to_string())?;

    let timeout = Duration::from_millis(input.timeout_ms.unwrap_or(20_000).clamp(1_000, 120_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, input.url.trim());

    if let Some(headers) = input.headers {
        for (k, v) in headers {
            if !k.trim().is_empty() {
                req = req.header(k, v);
            }
        }
    }

    if let Some(body) = input.body {
        if !body.is_empty() {
            req = req.body(body);
        }
    }

    let start = Instant::now();
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let elapsed = start.elapsed().as_millis();

    let status = resp.status();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.to_string(),
                v.to_str().unwrap_or("<binary header>").to_string(),
            )
        })
        .collect();

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpResponseOutput {
        ok: status.is_success(),
        status: status.as_u16(),
        status_text: status
            .canonical_reason()
            .unwrap_or("Unknown Status")
            .to_string(),
        elapsed_ms: elapsed,
        headers,
        body,
    })
}

const API_SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    "__pycache__",
];

const API_SCAN_EXTS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "php", "rb",
];

#[tauri::command]
pub fn discover_api_endpoints(root: String) -> Result<Vec<DiscoveredEndpoint>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    collect_files(&root_path, &mut files);

    let mut endpoints: Vec<DiscoveredEndpoint> = Vec::new();
    for file in files {
        let Ok(content) = fs::read_to_string(&file) else { continue };
        let rel = file
            .strip_prefix(&root_path)
            .ok()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| file.to_string_lossy().to_string());

        for (idx, line) in content.lines().enumerate() {
            if let Some((method, path)) = detect_endpoint_in_line(line) {
                endpoints.push(DiscoveredEndpoint {
                    method: method.to_string(),
                    path: path.to_string(),
                    file: rel.clone(),
                    line: idx + 1,
                });
            }
        }
    }

    endpoints.sort_by(|a, b| {
        a.path
            .to_lowercase()
            .cmp(&b.path.to_lowercase())
            .then(a.method.cmp(&b.method))
            .then(a.file.cmp(&b.file))
            .then(a.line.cmp(&b.line))
    });

    endpoints.dedup_by(|a, b| {
        a.method == b.method && a.path == b.path && a.file == b.file && a.line == b.line
    });
    endpoints.truncate(1000);

    Ok(endpoints)
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            if !API_SKIP_DIRS.contains(&name.as_str()) {
                collect_files(&path, out);
            }
            continue;
        }

        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if API_SCAN_EXTS.contains(&ext.to_lowercase().as_str()) {
                out.push(path);
            }
        }
    }
}

fn detect_endpoint_in_line(line: &str) -> Option<(&'static str, String)> {
    let methods = [
        ("GET", [".get(", "@Get(", "@GetMapping("]),
        ("POST", [".post(", "@Post(", "@PostMapping("]),
        ("PUT", [".put(", "@Put(", "@PutMapping("]),
        ("PATCH", [".patch(", "@Patch(", "@PatchMapping("]),
        ("DELETE", [".delete(", "@Delete(", "@DeleteMapping("]),
    ];

    for (method, patterns) in methods {
        for pattern in patterns {
            if let Some(path) = extract_path_after(line, pattern) {
                return Some((method, path));
            }
        }
    }
    None
}

fn extract_path_after(line: &str, marker: &str) -> Option<String> {
    let idx = line.find(marker)?;
    let after = &line[idx + marker.len()..];
    let quote_pos = after.find(&['\'', '"', '`'][..])?;
    let quote = after.as_bytes()[quote_pos] as char;
    let rem = &after[quote_pos + 1..];
    let end = rem.find(quote)?;
    let raw = rem[..end].trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.to_string())
}
