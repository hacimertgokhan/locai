import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileEntry } from "../../types";
import { useEditorStore } from "../../store/editorStore";
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
}: {
  entry: FileEntry;
  depth: number;
  onFileClick: (entry: FileEntry) => void;
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

  if (entry.isDir) {
    const isLazy = entry.children === null || entry.children === undefined;
    return (
      <div className="fn">
        <div
          className="frow dir"
          style={{ paddingLeft: indent }}
          onClick={handleDirClick}
        >
          <span className="chevron">{loading ? "…" : expanded ? "▾" : "▸"}</span>
          <span className="fname">{entry.name}{isLazy ? "" : ""}</span>
        </div>
        {expanded && children && (
          <div>
            {children.map((c) => (
              <FileNode key={c.path} entry={c} depth={depth + 1} onFileClick={onFileClick} />
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

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    setWorkspacePath(selected);
    setTerminalCwd(activeTerminalId, selected);
    const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: selected });
    setTabFileTree(entries);
  };

  // Listen for programmatic workspace opens (e.g. after agent creates a project)
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, entries } = (e as CustomEvent).detail as { path: string; entries: FileEntry[] };
      setWorkspacePath(path);
      setTabFileTree(entries);
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

  const folderName = workspacePath?.split("/").pop()?.toUpperCase() ?? "EXPLORER";

  return (
    <div className="filetree">
      <div className="ft-header">
        <span className="ft-title">{folderName}</span>
        <button className="ft-btn" onClick={handleOpenFolder} title="Open Folder">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
          </svg>
        </button>
      </div>
      <div className="ft-body">
        {tree.length === 0 ? (
          <div className="ft-empty" onClick={handleOpenFolder}>
            <span>open folder</span>
          </div>
        ) : (
          tree.map((e) => (
            <FileNode key={e.path} entry={e} depth={0} onFileClick={handleFileClick} />
          ))
        )}
      </div>
    </div>
  );
}
