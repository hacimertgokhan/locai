use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub id: usize,
    pub old_start: usize, // 1-based line number in original
    pub old_count: usize,
    pub new_start: usize, // 1-based line number in modified
    pub new_count: usize,
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
    pub kind: HunkKind,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum HunkKind {
    Add,
    Remove,
    Change,
}

#[tauri::command]
pub fn compute_diff(original: String, modified: String) -> Vec<DiffHunk> {
    let diff = TextDiff::from_lines(&original, &modified);
    let mut hunks: Vec<DiffHunk> = vec![];
    let mut hunk_id = 0usize;

    // Track consecutive changed groups
    let mut old_start = 0usize;
    let mut new_start = 0usize;
    let mut old_lines: Vec<String> = vec![];
    let mut new_lines: Vec<String> = vec![];
    let mut in_hunk = false;
    let mut cur_old = 1usize;
    let mut cur_new = 1usize;
    let mut hunk_old_start = 1usize;
    let mut hunk_new_start = 1usize;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                if in_hunk {
                    // Flush current hunk
                    let kind = if old_lines.is_empty() {
                        HunkKind::Add
                    } else if new_lines.is_empty() {
                        HunkKind::Remove
                    } else {
                        HunkKind::Change
                    };
                    hunks.push(DiffHunk {
                        id: hunk_id,
                        old_start: hunk_old_start,
                        old_count: old_lines.len(),
                        new_start: hunk_new_start,
                        new_count: new_lines.len(),
                        old_lines: old_lines.clone(),
                        new_lines: new_lines.clone(),
                        kind,
                    });
                    hunk_id += 1;
                    old_lines.clear();
                    new_lines.clear();
                    in_hunk = false;
                }
                cur_old += 1;
                cur_new += 1;
            }
            ChangeTag::Delete => {
                if !in_hunk {
                    hunk_old_start = cur_old;
                    hunk_new_start = cur_new;
                    in_hunk = true;
                }
                old_lines.push(change.value().trim_end_matches('\n').to_string());
                cur_old += 1;
            }
            ChangeTag::Insert => {
                if !in_hunk {
                    hunk_old_start = cur_old;
                    hunk_new_start = cur_new;
                    in_hunk = true;
                }
                new_lines.push(change.value().trim_end_matches('\n').to_string());
                cur_new += 1;
            }
        }
        let _ = (old_start, new_start); // suppress unused warnings
        old_start = cur_old;
        new_start = cur_new;
    }

    // Flush last hunk if any
    if in_hunk {
        let kind = if old_lines.is_empty() {
            HunkKind::Add
        } else if new_lines.is_empty() {
            HunkKind::Remove
        } else {
            HunkKind::Change
        };
        hunks.push(DiffHunk {
            id: hunk_id,
            old_start: hunk_old_start,
            old_count: old_lines.len(),
            new_start: hunk_new_start,
            new_count: new_lines.len(),
            old_lines,
            new_lines,
            kind,
        });
    }

    hunks
}
