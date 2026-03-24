import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileEntry } from "../../types";
import { useEditorStore, ProjectInfo } from "../../store/editorStore";
import "./FileTree.css";

const EXT_COLOR: Record<string, string> = {
  rs: "#ce9060", ts: "#3b82f6", tsx: "#06b6d4", js: "#eab308", jsx: "#f97316",
  py: "#84cc16", go: "#22d3ee", css: "#a78bfa", html: "#f87171", json: "#fbbf24",
  md: "#94a3b8", toml: "#fb923c", yaml: "#34d399", yml: "#34d399", sh: "#a3e635",
  sql: "#60a5fa", cpp: "#f472b6", c: "#93c5fd", cs: "#818cf8", java: "#fb923c",
  svelte: "#fb923c", vue: "#4ade80", scss: "#c084fc",
};

function getExt(name: string) {
  const p = name.split(".");
  return p.length > 1 ? p[p.length - 1].toLowerCase() : "";
}

function FileNode({
  entry,
  depth,
  onFileClick,
  onContextMenu,
  onDropEntry,
  workspacePath
}: {
  entry: FileEntry;
  depth: number;
  onFileClick: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onDropEntry: (sourcePath: string, targetDir: string) => void;
  workspacePath: string;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [children, setChildren] = useState<FileEntry[] | null>(entry.children ?? null);
  const [loading, setLoading] = useState(false);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const indent = depth * 14 + 8;

  const handleDirClick = async () => {
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const loaded = await invoke<FileEntry[]>("read_dir_shallow", { path: entry.path });
        setChildren(loaded);
      } catch (e) {
        console.error(e);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", entry.path);
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (entry.isDir) {
      e.dataTransfer.dropEffect = "move";
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!entry.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (sourcePath && sourcePath !== entry.path) {
      onDropEntry(sourcePath, entry.path);
    }
  };

  if (entry.isDir) {
    const isLazy = entry.children === null || entry.children === undefined;
    return (
      <div className="fn">
        <div
          className="frow dir"
          style={{ paddingLeft: indent }}
          onClick={handleDirClick}
          onContextMenu={(e) => onContextMenu(e, entry)}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <span className="chevron">{loading ? "…" : expanded ? "▾" : "▸"}</span>
          <span className="fname">{entry.name}{isLazy ? "" : ""}</span>
        </div>
        {expanded && children && (
          <div>
            {children.map((c) => (
              <FileNode key={c.path} entry={c} depth={depth + 1} onFileClick={onFileClick} onContextMenu={onContextMenu} onDropEntry={onDropEntry} workspacePath={workspacePath} />
            ))}
            {children.length === 0 && (
              <div className="empty-dir" style={{ paddingLeft: indent + 20 }}>empty</div>
            )}
          </div>
        )}
      </div>
    );
  }

  const ext = getExt(entry.name);
  const dotColor = EXT_COLOR[ext] ?? "var(--text-muted)";
  const isActive = activeFilePath === entry.path;

  return (
    <div
      className={`frow file ${isActive ? "active" : ""}`}
      style={{ paddingLeft: indent + 16 }}
      onClick={() => onFileClick(entry)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      draggable
      onDragStart={handleDragStart}
    >
      <span className="fdot" style={{ background: dotColor }} />
      <span className="fname">{entry.name}</span>
    </div>
  );
}

export function FileTree() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);
  const setTerminalCwd = useEditorStore((s) => s.setTerminalCwd);
  const activeTerminalId = useEditorStore((s) => s.activeTerminalId);
  const openFile = useEditorStore((s) => s.openFile);
  const setTabFileTree = useEditorStore((s) => s.setTabFileTree);
  // Derive tree from store so tab switches update it automatically
  const tree = useEditorStore((s) => s.fileTree);
  
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry?: FileEntry | null } | null>(null);
  const [promptData, setPromptData] = useState<{ type: "createFile" | "createFolder" | "rename" | "delete"; path: string; initialValue?: string } | null>(null);
  const [promptInputValue, setPromptInputValue] = useState("");

  const refreshTree = async (currentWorkspace?: string | null) => {
    const path = currentWorkspace || workspacePath;
    if (!path) return;
    try {
      const entries = await invoke<FileEntry[]>("read_dir_recursive", { path });
      setTabFileTree(entries);
    } catch (e) {
      console.error("Failed to refresh file tree:", e);
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    setWorkspacePath(selected);
    setTerminalCwd(activeTerminalId, selected);
    const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: selected });
    setTabFileTree(entries);
    scanProjectType(entries);
  };

  const scanProjectType = async (treeNodes: FileEntry[]) => {
    const pkgNode = treeNodes.find(n => n.name === "package.json" && !n.isDir);
    if (!pkgNode) {
      useEditorStore.getState().setProjectInfo({ type: "unknown" });
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path: pkgNode.path });
      const pkg = JSON.parse(content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      
      const info: ProjectInfo = { type: "unknown" };
      if (deps["express"]) {
        info.type = "backend";
        info.framework = "express";
      } else if (deps["next"]) {
        info.type = "frontend";
        info.framework = "next";
      } else if (deps["vite"]) {
        info.type = "frontend";
        info.framework = "vite";
      } else if (deps["react"]) {
        info.type = "frontend";
        info.framework = "react";
      } else if (deps["vue"]) {
        info.type = "frontend";
        info.framework = "vue";
      }
      useEditorStore.getState().setProjectInfo(info);
    } catch (e) {
      console.error("Failed to parse package.json for project detection:", e);
    }
  };

  // Listen for programmatic workspace opens (e.g. after agent creates a project)
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, entries } = (e as CustomEvent).detail as { path: string; entries: FileEntry[] };
      setWorkspacePath(path);
      setTabFileTree(entries);
      scanProjectType(entries);
    };
    window.addEventListener("locai:open-workspace", handler);
    return () => window.removeEventListener("locai:open-workspace", handler);
  }, [setWorkspacePath, setTabFileTree]);

  const handleFileClick = async (entry: FileEntry) => {
    try {
      const content = await invoke<string>("read_file", { path: entry.path });
      const language = await invoke<string>("get_file_language", { path: entry.path });
      openFile({ path: entry.path, name: entry.name, content, language, isDirty: false });
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry?: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  useEffect(() => {
    const closeMenu = () => setCtxMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleCreateFile = (parentPath: string) => {
    setPromptData({ type: "createFile", path: parentPath, initialValue: "" });
    setPromptInputValue("");
  };

  const handleCreateFolder = (parentPath: string) => {
    setPromptData({ type: "createFolder", path: parentPath, initialValue: "" });
    setPromptInputValue("");
  };

  const handleRename = (entry: FileEntry) => {
    setPromptData({ type: "rename", path: entry.path, initialValue: entry.name });
    setPromptInputValue(entry.name);
  };

  const handleDelete = (entry: FileEntry) => {
    setPromptData({ type: "delete", path: entry.path });
  };

  const submitPrompt = async () => {
    if (!promptData) return;
    const val = promptInputValue.trim();
    try {
      if (promptData.type === "createFile" && val) {
        await invoke("agent_write_file", { path: `${promptData.path}/${val}`, content: "" });
      } else if (promptData.type === "createFolder" && val) {
        await invoke("agent_create_dir", { path: `${promptData.path}/${val}` });
      } else if (promptData.type === "rename" && val && val !== promptData.initialValue) {
        const parentPath = promptData.path.substring(0, promptData.path.lastIndexOf("/"));
        await invoke("agent_rename_path", { from: promptData.path, to: `${parentPath}/${val}` });
      } else if (promptData.type === "delete") {
        await invoke("agent_delete_path", { path: promptData.path });
      }
      await refreshTree();
    } catch (e) {
      console.error(e);
    } finally {
      setPromptData(null);
    }
  };

  const handleDropEntry = async (sourcePath: string, targetDirPath: string) => {
    const name = sourcePath.split("/").pop();
    if (!name) return;
    try {
      await invoke("agent_rename_path", { from: sourcePath, to: `${targetDirPath}/${name}` });
      await refreshTree();
    } catch (e) { alert(`Failed to move: ${e}`); }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!workspacePath) return;
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (sourcePath && !sourcePath.startsWith(workspacePath)) {
       // Ignore external drags for now
    } else if (sourcePath) {
      handleDropEntry(sourcePath, workspacePath);
    }
  };

  const folderName = workspacePath?.split("/").pop()?.toUpperCase() ?? "EXPLORER";

  return (
    <div className="filetree" onContextMenu={(e) => handleContextMenu(e, undefined)}>
      <div className="ft-header">
        <span className="ft-title">{folderName}</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {workspacePath && (
             <>
               <button className="ft-btn" onClick={(e) => { e.stopPropagation(); handleCreateFile(workspacePath); }} title="New File">📄</button>
               <button className="ft-btn" onClick={(e) => { e.stopPropagation(); handleCreateFolder(workspacePath); }} title="New Folder">📁</button>
             </>
          )}
          <button className="ft-btn" onClick={handleOpenFolder} title="Open Folder">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="ft-body" onDragOver={handleRootDragOver} onDrop={handleRootDrop}>
        {tree.length === 0 ? (
          <div className="ft-empty" onClick={handleOpenFolder}>
            <span>open folder</span>
          </div>
        ) : (
          tree.map((e) => (
            <FileNode key={e.path} entry={e} depth={0} onFileClick={handleFileClick} onContextMenu={handleContextMenu} onDropEntry={handleDropEntry} workspacePath={workspacePath!} />
          ))
        )}
      </div>

      {ctxMenu && (
        <div className="ft-ctx-menu animate-fade-in" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          {ctxMenu.entry?.isDir ? (
            <>
              <button className="ft-ctx-item" onClick={() => handleCreateFile(ctxMenu.entry!.path)}>New File</button>
              <button className="ft-ctx-item" onClick={() => handleCreateFolder(ctxMenu.entry!.path)}>New Folder</button>
              <div className="ft-ctx-sep" />
            </>
          ) : !ctxMenu.entry && workspacePath ? (
             <>
              <button className="ft-ctx-item" onClick={() => handleCreateFile(workspacePath)}>New File</button>
              <button className="ft-ctx-item" onClick={() => handleCreateFolder(workspacePath)}>New Folder</button>
              <div className="ft-ctx-sep" />
             </>
          ) : null}
          {ctxMenu.entry && (
            <>
              <button className="ft-ctx-item" onClick={() => { handleRename(ctxMenu.entry!); setCtxMenu(null); }}>Rename</button>
              <button className="ft-ctx-item delete" onClick={() => { handleDelete(ctxMenu.entry!); setCtxMenu(null); }}>Delete</button>
            </>
          )}
        </div>
      )}

      {promptData && (
        <div className="ft-prompt-overlay" onClick={() => setPromptData(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="ft-prompt-box animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-lighter)", padding: "16px", borderRadius: "8px", border: "1px solid var(--border)", width: "260px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
            <div style={{ marginBottom: "12px", color: "var(--text-primary)", fontWeight: 500 }}>
              {promptData.type === "delete" ? "Delete Item?" : promptData.type === "rename" ? "Rename" : promptData.type === "createFile" ? "New File" : "New Folder"}
            </div>
            {promptData.type === "delete" ? (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", wordBreak: "break-all" }}>
                Are you sure you want to delete this {promptData.path.split("/").pop()}?
              </div>
            ) : (
              <input 
                autoFocus
                className="s-input" 
                value={promptInputValue} 
                onChange={(e) => setPromptInputValue(e.target.value)} 
                onKeyDown={(e) => { if (e.key === "Enter") submitPrompt(); if (e.key === "Escape") setPromptData(null); }}
                style={{ width: "100%", marginBottom: "16px" }}
              />
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="s-cancel" onClick={() => setPromptData(null)}>Cancel</button>
              <button className={promptData.type === "delete" ? "s-save" : "s-save"} style={promptData.type === "delete" ? { background: "var(--git-deleted)" } : undefined} onClick={submitPrompt}>
                {promptData.type === "delete" ? "Delete" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
