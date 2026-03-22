use serde::{Deserialize, Serialize};
use std::fs;
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
