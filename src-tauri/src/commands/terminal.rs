use serde::Serialize;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct TerminalOutput {
    pub session_id: String,
    pub text: String,
    pub stream: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TerminalDone {
    pub session_id: String,
    pub code: i32,
}

#[tauri::command]
pub async fn run_terminal_command(
    app: AppHandle,
    session_id: String,
    cmd: String,
    cwd: String,
) -> Result<i32, String> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app1 = app.clone();
    let sid1 = session_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app1.emit("terminal-output", TerminalOutput {
                session_id: sid1.clone(),
                text: line,
                stream: "stdout".into(),
            });
        }
    });

    let app2 = app.clone();
    let sid2 = session_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app2.emit("terminal-output", TerminalOutput {
                session_id: sid2.clone(),
                text: line,
                stream: "stderr".into(),
            });
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let code = status.code().unwrap_or(-1);

    app.emit("terminal-done", TerminalDone { session_id, code })
        .map_err(|e| e.to_string())?;
    Ok(code)
}
