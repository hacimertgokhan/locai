use git2::{BranchType, Repository, StatusOptions};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
}

fn status_label(s: git2::Status) -> Option<(&'static str, bool)> {
    if s.contains(git2::Status::INDEX_NEW) {
        return Some(("added", true));
    }
    if s.contains(git2::Status::INDEX_MODIFIED) {
        return Some(("modified", true));
    }
    if s.contains(git2::Status::INDEX_DELETED) {
        return Some(("deleted", true));
    }
    if s.contains(git2::Status::INDEX_RENAMED) {
        return Some(("renamed", true));
    }
    if s.contains(git2::Status::WT_MODIFIED) {
        return Some(("modified", false));
    }
    if s.contains(git2::Status::WT_DELETED) {
        return Some(("deleted", false));
    }
    if s.contains(git2::Status::WT_NEW) {
        return Some(("untracked", false));
    }
    if s.contains(git2::Status::WT_RENAMED) {
        return Some(("renamed", false));
    }
    if s.contains(git2::Status::CONFLICTED) {
        return Some(("conflict", false));
    }
    None
}

#[tauri::command]
pub fn git_status(path: String) -> Result<Vec<GitStatusEntry>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for entry in statuses.iter() {
        let file_path = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        if let Some((label, staged)) = status_label(s) {
            entries.push(GitStatusEntry {
                path: file_path,
                status: label.to_string(),
                staged,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_log(path: String, limit: usize) -> Result<Vec<GitCommit>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let short_id = format!("{:.7}", commit.id());
        let message = commit
            .summary()
            .unwrap_or("(no message)")
            .to_string();
        let author = commit.author().name().unwrap_or("Unknown").to_string();
        let time = commit.time().seconds();

        commits.push(GitCommit {
            id: short_id,
            message,
            author,
            time,
        });
    }

    Ok(commits)
}

#[tauri::command]
pub fn git_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let head = repo.head().ok();
    let head_name = head
        .as_ref()
        .and_then(|h| h.shorthand())
        .unwrap_or("")
        .to_string();

    let branches = repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for branch in branches {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        if let Some(name) = branch.name().ok().flatten() {
            result.push(GitBranch {
                is_current: name == head_name,
                name: name.to_string(),
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for f in &files {
        index.add_path(std::path::Path::new(f)).map_err(|e| e.to_string())?;
    }
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    if let Some(head_commit) = head {
        let head_tree = head_commit.tree().map_err(|e| e.to_string())?;
        let pathspecs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
        repo.reset_default(Some(head_tree.as_object()), pathspecs.iter().copied())
            .map_err(|e| e.to_string())?;
    } else {
        // Initial repo — remove from index
        let mut index = repo.index().map_err(|e| e.to_string())?;
        for f in &files {
            index
                .remove_path(std::path::Path::new(f))
                .map_err(|e| e.to_string())?;
        }
        index.write().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    Ok(format!("{:.7}", oid))
}

#[tauri::command]
pub fn git_checkout_branch(path: String, branch_name: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let branch = repo
        .find_branch(&branch_name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    let obj = branch
        .get()
        .peel(git2::ObjectType::Commit)
        .map_err(|e| e.to_string())?;
    repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{}", branch_name))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = repo
        .diff_index_to_workdir(None, Some(&mut opts))
        .map_err(|e| e.to_string())?;

    let mut result = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        use git2::DiffLineType::*;
        let prefix = match line.origin_value() {
            Addition => "+",
            Deletion => "-",
            Context => " ",
            _ => "",
        };
        result.push_str(prefix);
        result.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub fn git_current_branch(path: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}
