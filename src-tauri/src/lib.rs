mod commands;

use commands::agent::{
    agent_create_dir, agent_delete_path, agent_rename_path, agent_run_command,
    agent_write_file, call_llm_step,
};
use commands::diff::compute_diff;
use commands::file::{
    get_file_language, read_dir_recursive, read_dir_shallow, read_file,
    replace_in_file, search_in_files, write_file,
};
use commands::git::{
    git_branches, git_checkout_branch, git_commit, git_current_branch, git_diff_file, git_log,
    git_stage, git_status, git_unstage, git_stash, git_stash_pop, git_diff_staged,
};
use commands::llm::{list_lmstudio_models, list_ollama_models, stream_llm};
use commands::terminal::run_terminal_command;
use commands::system::{get_mac_battery, get_mac_media_info, control_mac_media};

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
            run_terminal_command,
            git_status,
            git_log,
            git_branches,
            git_stage,
            git_unstage,
            git_commit,
            git_checkout_branch,
            git_diff_file,
            git_current_branch,
            git_stash,
            git_stash_pop,
            git_diff_staged,
            search_in_files,
            replace_in_file,
            // Agent commands
            call_llm_step,
            agent_write_file,
            agent_delete_path,
            agent_rename_path,
            agent_create_dir,
            agent_run_command,
            // System commands
            get_mac_battery,
            get_mac_media_info,
            control_mac_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running locai");
}
