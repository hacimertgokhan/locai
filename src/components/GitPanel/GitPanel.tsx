import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { GitBranch, GitCommit, GitStatusEntry, AgentMessage, LlmStepResult } from "../../types";
import "./GitPanel.css";

type GitTab = "changes" | "log";

function statusIcon(status: string, _staged: boolean) {
  const icons: Record<string, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    untracked: "U",
    conflict: "!",
  };
  return icons[status] ?? "?";
}

function statusColor(status: string): string {
  if (status === "added") return "git-added";
  if (status === "deleted") return "git-deleted";
  if (status === "modified") return "git-modified";
  if (status === "untracked") return "git-untracked";
  if (status === "conflict") return "git-conflict";
  return "";
}

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function GitPanel() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const [tab, setTab] = useState<GitTab>("changes");
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBranches, setShowBranches] = useState(false);
  
  const provider = useEditorStore(s => s.provider);
  const settings = useEditorStore(s => s.settings);
  const selectedModel = useEditorStore(s => s.selectedModel);

  const repoPath = workspacePath ?? "";

  const refresh = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError("");
    try {
      const [st, br, head] = await Promise.all([
        invoke<GitStatusEntry[]>("git_status", { path: repoPath }),
        invoke<GitBranch[]>("git_branches", { path: repoPath }),
        invoke<string>("git_current_branch", { path: repoPath }),
      ]);
      setStatus(st);
      setBranches(br);
      setCurrentBranch(head);
    } catch (e: any) {
      setError(typeof e === "string" ? e : "Not a git repository");
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  const loadLog = useCallback(async () => {
    if (!repoPath) return;
    try {
      const log = await invoke<GitCommit[]>("git_log", { path: repoPath, limit: 30 });
      setCommits(log);
    } catch {
      setCommits([]);
    }
  }, [repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === "log") loadLog();
  }, [tab, loadLog]);

  const staged = status.filter((s) => s.staged);
  const unstaged = status.filter((s) => !s.staged);

  const handleStage = async (filePath: string) => {
    try {
      await invoke("git_stage", { path: repoPath, files: [filePath] });
      refresh();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleUnstage = async (filePath: string) => {
    try {
      await invoke("git_unstage", { path: repoPath, files: [filePath] });
      refresh();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleStageAll = async () => {
    if (unstaged.length === 0) return;
    try {
      await invoke("git_stage", { path: repoPath, files: unstaged.map((f) => f.path) });
      refresh();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || staged.length === 0) return;
    try {
      await invoke<string>("git_commit", { path: repoPath, message: commitMsg.trim() });
      setCommitMsg("");
      refresh();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleCheckout = async (name: string) => {
    try {
      await invoke("git_checkout_branch", { path: repoPath, branchName: name });
      setShowBranches(false);
      refresh();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const handleStash = async () => {
    try {
      await invoke("git_stash", { path: repoPath });
      refresh();
    } catch (e: any) { setError(String(e)); }
  };

  const handleStashPop = async () => {
    try {
      await invoke("git_stash_pop", { path: repoPath });
      refresh();
    } catch (e: any) { setError(String(e)); }
  };

  const handleAutoCommit = async () => {
    if (!repoPath || staged.length === 0) return;
    try {
      setCommitMsg("Generating...");
      const diff = await invoke<string>("git_diff_staged", { path: repoPath });
      const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;
      const msgs: AgentMessage[] = [
        { role: "system", content: "You are an expert developer. Create a concise, conventional git commit message for the following diff (e.g. `feat: added auto commit`). Only output the raw commit message. Do not wrap in quotes or code blocks." },
        { role: "user", content: diff.slice(0, 15000) }
      ];
      const result = await invoke<LlmStepResult>("call_llm_step", {
        provider, baseUrl, model: selectedModel, messages: msgs, tools: []
      });
      if (result.type === "content") {
        let msg = result.content ?? "";
        msg = msg.replace(/^```[\w]*\n?/g, "").replace(/```$/g, "").trim();
        msg = msg.replace(/^"|"$/g, "").trim();
        setCommitMsg(msg);
      }
    } catch (e: any) {
      setError(String(e));
      setCommitMsg("");
    }
  };

  const handleInit = async () => {
    try {
      setLoading(true);
      await invoke("agent_run_command", { cwd: repoPath, command: "git init" });
      await refresh();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!repoPath) {
    return (
      <div className="git-empty">
        <span>Open a workspace folder to use Git.</span>
      </div>
    );
  }

  const isMissingRepo = error && (
    error.toLowerCase().includes("not a git repository") || 
    error.toLowerCase().includes("could not find repository") ||
    error.toLowerCase().includes("repository not found")
  );

  if (isMissingRepo) {
    return (
      <div className="git-empty" style={{ flexDirection: "column", gap: "12px" }}>
        <span>Not a git repository.</span>
        <button className="git-commit-btn" onClick={handleInit} disabled={loading} style={{ width: "auto", padding: "6px 16px" }}>
          {loading ? "Initializing..." : "Initialize Repository"}
        </button>
      </div>
    );
  }

  return (
    <div className="git-panel">
      {/* Branch header */}
      <div className="git-branch-bar">
        <button
          className="git-branch-btn"
          onClick={() => setShowBranches(!showBranches)}
          title="Switch branch"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z"/>
          </svg>
          <span>{currentBranch || "no branch"}</span>
          <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
        <button className="git-refresh-btn" onClick={refresh} title="Refresh" disabled={loading}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ transform: loading ? "rotate(360deg)" : undefined }}>
            <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
            <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
          </svg>
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          <button className="git-refresh-btn" onClick={handleStash} title="Stash Changes" style={{ padding: "0 8px", width: "auto" }}>Stash</button>
          <button className="git-refresh-btn" onClick={handleStashPop} title="Pop Stash" style={{ padding: "0 8px", width: "auto" }}>Pop</button>
        </div>
      </div>

      {/* Branch dropdown */}
      {showBranches && (
        <div className="git-branch-list animate-slide-up">
          {branches.map((b) => (
            <button
              key={b.name}
              className={`git-branch-item ${b.is_current ? "active" : ""}`}
              onClick={() => handleCheckout(b.name)}
            >
              {b.is_current && <span className="git-branch-dot" />}
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="git-tabs">
        <button
          className={`git-tab ${tab === "changes" ? "active" : ""}`}
          onClick={() => setTab("changes")}
        >
          Changes{status.length > 0 && <span className="git-badge">{status.length}</span>}
        </button>
        <button
          className={`git-tab ${tab === "log" ? "active" : ""}`}
          onClick={() => setTab("log")}
        >
          History
        </button>
      </div>

      {error && (
        <div className="git-error">{error}</div>
      )}

      {tab === "changes" && (
        <div className="git-changes">
          {/* Staged */}
          {staged.length > 0 && (
            <div className="git-section">
              <div className="git-section-header">
                <span>Staged ({staged.length})</span>
              </div>
              {staged.map((f) => (
                <div key={f.path} className="git-file-row">
                  <span className={`git-file-icon ${statusColor(f.status)}`}>
                    {statusIcon(f.status, true)}
                  </span>
                  <span className="git-file-path" title={f.path}>
                    {f.path.split("/").pop()}
                    <span className="git-file-dir">{f.path.includes("/") ? " " + f.path.split("/").slice(0, -1).join("/") : ""}</span>
                  </span>
                  <button
                    className="git-file-action"
                    onClick={() => handleUnstage(f.path)}
                    title="Unstage"
                  >
                    −
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Unstaged */}
          {unstaged.length > 0 && (
            <div className="git-section">
              <div className="git-section-header">
                <span>Changes ({unstaged.length})</span>
                <button className="git-stage-all" onClick={handleStageAll}>Stage all</button>
              </div>
              {unstaged.map((f) => (
                <div key={f.path} className="git-file-row">
                  <span className={`git-file-icon ${statusColor(f.status)}`}>
                    {statusIcon(f.status, false)}
                  </span>
                  <span className="git-file-path" title={f.path}>
                    {f.path.split("/").pop()}
                    <span className="git-file-dir">{f.path.includes("/") ? " " + f.path.split("/").slice(0, -1).join("/") : ""}</span>
                  </span>
                  <button
                    className="git-file-action"
                    onClick={() => handleStage(f.path)}
                    title="Stage"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}

          {status.length === 0 && !loading && !error && (
            <div className="git-clean">No changes</div>
          )}

          {/* Commit */}
          {staged.length > 0 && (
            <div className="git-commit-area">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Message:</span>
                <button
                  className="git-refresh-btn"
                  onClick={handleAutoCommit}
                  disabled={!selectedModel || commitMsg === "Generating..."}
                  title={selectedModel ? "Generate commit message with AI" : "Select an AI model in Settings first"}
                  style={{ padding: "2px 8px", width: "auto", fontSize: 11, background: "var(--bg-lighter)" }}
                >
                  ✨ Auto
                </button>
              </div>
              <textarea
                className="git-commit-msg"
                placeholder="Commit message…"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                rows={2}
              />
              <button
                className="git-commit-btn"
                onClick={handleCommit}
                disabled={!commitMsg.trim()}
              >
                Commit to {currentBranch}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="git-log">
          {commits.length === 0 && (
            <div className="git-clean">No commits yet</div>
          )}
          {commits.map((c) => (
            <div key={c.id} className="git-commit-row">
              <div className="git-commit-top">
                <span className="git-commit-sha">{c.id}</span>
                <span className="git-commit-time">{relTime(c.time)}</span>
              </div>
              <div className="git-commit-msg-text">{c.message}</div>
              <div className="git-commit-author">{c.author}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
