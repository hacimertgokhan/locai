use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub fn read_dir_recursive(path: String) -> Result<Vec<FileEntry>, String> {
    read_dir_inner(&path, 0).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_dir_shallow(path: String) -> Result<Vec<FileEntry>, String> {
    read_dir_level(&path).map_err(|e| e.to_string())
}

fn read_dir_inner(path: &str, depth: u32) -> Result<Vec<FileEntry>, std::io::Error> {
    let mut entries = vec![];
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type()?.is_dir();

        // These dirs are shown but not expanded by default (lazy load)
        let lazy_dirs = ["node_modules", "target", ".git", "dist", "build", ".next", "__pycache__"];
        if is_dir && lazy_dirs.contains(&file_name.as_str()) {
            entries.push(FileEntry {
                name: file_name,
                path: entry_path,
                is_dir: true,
                children: None,
            });
            continue;
        }

        let children = if is_dir && depth < 8 {
            read_dir_inner(&entry_path, depth + 1).ok()
        } else if is_dir {
            Some(vec![])
        } else {
            None
        };

        entries.push(FileEntry { name: file_name, path: entry_path, is_dir, children });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

fn read_dir_level(path: &str) -> Result<Vec<FileEntry>, std::io::Error> {
    let mut entries = vec![];
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') { continue; }
        let entry_path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type()?.is_dir();
        entries.push(FileEntry { name: file_name, path: entry_path, is_dir, children: None });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

// ── File search ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub file: String,
    pub line_num: usize,
    pub text: String,
    pub col_start: usize,
    pub col_end: usize,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", ".next",
    "__pycache__", ".cache", "coverage", ".turbo",
];

const TEXT_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cs", "cpp", "c", "h",
    "css", "scss", "sass", "html", "json", "toml", "yaml", "yml", "md", "txt",
    "sh", "bash", "zsh", "sql", "xml", "svelte", "vue", "kt", "swift", "rb",
    "php", "lua", "r", "dart", "scala", "clj", "ex", "exs", "zig",
];

fn is_text_file(name: &str) -> bool {
    if let Some(ext) = name.rsplit('.').next() {
        return TEXT_EXTENSIONS.contains(&ext.to_lowercase().as_str());
    }
    false
}

fn search_dir(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    matches: &mut Vec<SearchMatch>,
    root_prefix_len: usize,
) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let path = entry.path();
        if path.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                search_dir(&path, query, case_sensitive, matches, root_prefix_len);
            }
        } else if is_text_file(&name) {
            let Ok(file) = fs::File::open(&path) else { continue };
            let file_str = path.to_string_lossy()[root_prefix_len..].trim_start_matches('/').to_string();
            let reader = BufReader::new(file);
            for (idx, line) in reader.lines().enumerate() {
                let Ok(line_text) = line else { continue };
                let (haystack, needle) = if case_sensitive {
                    (line_text.clone(), query.to_string())
                } else {
                    (line_text.to_lowercase(), query.to_lowercase())
                };
                let mut start = 0;
                while let Some(col) = haystack[start..].find(&needle) {
                    let abs_col = start + col;
                    matches.push(SearchMatch {
                        file: file_str.clone(),
                        line_num: idx + 1,
                        text: line_text.clone(),
                        col_start: abs_col,
                        col_end: abs_col + query.len(),
                    });
                    start = abs_col + 1;
                    if start >= haystack.len() { break; }
                }
            }
        }
    }
}

#[tauri::command]
pub fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchMatch>, String> {
    if query.is_empty() { return Ok(vec![]); }
    let root_path = Path::new(&root);
    let mut matches = Vec::new();
    let prefix_len = root.len();
    search_dir(root_path, &query, case_sensitive, &mut matches, prefix_len);
    matches.truncate(500); // cap results for performance
    Ok(matches)
}

#[tauri::command]
pub fn replace_in_file(
    file_path: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<usize, String> {
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let (new_content, count) = if case_sensitive {
        let count = content.matches(&query).count();
        (content.replace(&query, &replacement), count)
    } else {
        // case-insensitive replace using split
        let lower = content.to_lowercase();
        let lower_q = query.to_lowercase();
        let mut result = String::with_capacity(content.len());
        let mut last = 0;
        let mut count = 0;
        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(&lower_q) {
            let abs = search_from + pos;
            result.push_str(&content[last..abs]);
            result.push_str(&replacement);
            last = abs + query.len();
            search_from = last;
            count += 1;
        }
        result.push_str(&content[last..]);
        (result, count)
    };
    if count > 0 {
        fs::write(&file_path, new_content).map_err(|e| e.to_string())?;
    }
    Ok(count)
}

#[tauri::command]
pub fn get_file_language(path: String) -> String {
    Path::new(&path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext {
            "rs" => "rust",
            "js" | "mjs" | "cjs" => "javascript",
            "ts" | "mts" => "typescript",
            "tsx" | "jsx" => "typescript",
            "py" => "python",
            "go" => "go",
            "cpp" | "cc" | "cxx" => "cpp",
            "c" | "h" => "c",
            "java" => "java",
            "cs" => "csharp",
            "html" | "htm" | "svelte" | "vue" => "html",
            "css" => "css",
            "scss" | "sass" => "scss",
            "json" => "json",
            "toml" => "toml",
            "yaml" | "yml" => "yaml",
            "md" => "markdown",
            "sh" | "bash" | "zsh" => "shell",
            "sql" => "sql",
            "xml" => "xml",
            _ => "plaintext",
        })
        .unwrap_or("plaintext")
        .to_string()
}
