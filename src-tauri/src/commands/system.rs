use std::process::Command;
use serde::Serialize;

#[derive(Serialize)]
pub struct BatteryInfo {
    pub level: Option<u8>,
    pub is_charging: bool,
}

#[derive(Serialize)]
pub struct MediaInfo {
    pub track_name: Option<String>,
    pub artist_name: Option<String>,
    pub app_name: Option<String>,
    pub is_playing: bool,
}

#[tauri::command]
pub fn get_mac_battery() -> Result<BatteryInfo, String> {
    let output = Command::new("pmset")
        .arg("-g")
        .arg("batt")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Default fallback
    let mut info = BatteryInfo { level: None, is_charging: false };

    // "Currently drawing from 'AC Power'" or "'Battery Power'"
    if stdout.contains("AC Power") || stdout.contains("charging") {
        info.is_charging = true;
    }

    // Parse percentage e.g., "100%;" or "84%;"
    if let Some(start) = stdout.find("\t") {
        let rest = &stdout[start..];
        if let Some(pct_idx) = rest.find('%') {
            let num_str = &rest[1..pct_idx].trim();
            if let Ok(level) = num_str.parse::<u8>() {
                info.level = Some(level);
            }
        }
    }

    Ok(info)
}

fn get_active_player() -> Option<&'static str> {
    // Check if Spotify is running
    let check_spotify = Command::new("osascript")
        .arg("-e")
        .arg("application \"Spotify\" is running")
        .output();
    
    if let Ok(out) = check_spotify {
        if String::from_utf8_lossy(&out.stdout).trim() == "true" {
            return Some("Spotify");
        }
    }

    // Check if Music is running
    let check_music = Command::new("osascript")
        .arg("-e")
        .arg("application \"Music\" is running")
        .output();
    
    if let Ok(out) = check_music {
        if String::from_utf8_lossy(&out.stdout).trim() == "true" {
            return Some("Music");
        }
    }
    
    None
}

#[tauri::command]
pub fn get_mac_media_info() -> Result<MediaInfo, String> {
    let mut info = MediaInfo {
        track_name: None,
        artist_name: None,
        app_name: None,
        is_playing: false,
    };

    let app = match get_active_player() {
        Some(name) => name,
        None => return Ok(info),
    };

    info.app_name = Some(app.to_string());

    // Check if playing
    let state_script = format!("tell application \"{}\" to player state", app);
    let state_out = Command::new("osascript").arg("-e").arg(&state_script).output();
    if let Ok(out) = state_out {
        if String::from_utf8_lossy(&out.stdout).trim() == "playing" {
            info.is_playing = true;
        }
    }

    // Get track
    let track_script = format!("tell application \"{}\" to name of current track", app);
    if let Ok(out) = Command::new("osascript").arg("-e").arg(&track_script).output() {
        let track = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !track.is_empty() {
            info.track_name = Some(track);
        }
    }

    // Get artist
    let artist_script = format!("tell application \"{}\" to artist of current track", app);
    if let Ok(out) = Command::new("osascript").arg("-e").arg(&artist_script).output() {
        let artist = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !artist.is_empty() {
            info.artist_name = Some(artist);
        }
    }

    Ok(info)
}

#[tauri::command]
pub fn control_mac_media(action: String) -> Result<(), String> {
    let app = match get_active_player() {
        Some(name) => name,
        None => return Err("No media player running".into()),
    };

    let script = match action.as_str() {
        "playpause" => format!("tell application \"{}\" to playpause", app),
        "next" => format!("tell application \"{}\" to next track", app),
        "prev" => format!("tell application \"{}\" to previous track", app),
        _ => return Err("Unknown action".into()),
    };

    Command::new("osascript").arg("-e").arg(&script).output().map_err(|e| e.to_string())?;
    Ok(())
}
