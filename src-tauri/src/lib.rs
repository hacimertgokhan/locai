mod commands;

use commands::diff::compute_diff;
use commands::file::{get_file_language, read_dir_recursive, read_dir_shallow, read_file, write_file};
use commands::llm::{list_lmstudio_models, list_ollama_models, stream_llm};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            read_dir_recursive,
            read_dir_shallow,
            get_file_language,
            compute_diff,
            list_ollama_models,
            list_lmstudio_models,
            stream_llm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running locai");
}
