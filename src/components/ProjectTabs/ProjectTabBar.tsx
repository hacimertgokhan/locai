import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";
import { FileEntry } from "../../types";
import "./ProjectTabBar.css";

export function ProjectTabBar() {
  const projectTabs = useEditorStore((s) => s.projectTabs);
  const activeProjectTabId = useEditorStore((s) => s.activeProjectTabId);
  const createProjectTab = useEditorStore((s) => s.createProjectTab);
  const closeProjectTab = useEditorStore((s) => s.closeProjectTab);
  const switchProjectTab = useEditorStore((s) => s.switchProjectTab);
  const renameProjectTab = useEditorStore((s) => s.renameProjectTab);
  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);
  const setTerminalCwd = useEditorStore((s) => s.setTerminalCwd);
  const activeTerminalId = useEditorStore((s) => s.activeTerminalId);
  const setTabFileTree = useEditorStore((s) => s.setTabFileTree);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Open folder for the active tab
  const handleOpenFolder = async (tabId: string) => {
    // Switch to that tab first so actions target it
    switchProjectTab(tabId);
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    setWorkspacePath(selected);
    setTerminalCwd(activeTerminalId, selected);
    const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: selected });
    setTabFileTree(entries);
  };

  const startRename = (tabId: string, currentName: string) => {
    setEditingId(tabId);
    setEditValue(currentName);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameProjectTab(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="project-tab-bar">
      <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, borderRight: "1px solid var(--border)" }}>
        <img src="/icon.png" alt="locai" style={{ height: 26, width: "auto", objectFit: "contain", borderRadius: 4 }} />
      </div>
      <div className="project-tabs-scroll">
        {projectTabs.map((tab) => (
          <div
            key={tab.id}
            className={`project-tab ${tab.id === activeProjectTabId ? "active" : ""}`}
            onClick={() => switchProjectTab(tab.id)}
            onDoubleClick={() => startRename(tab.id, tab.name)}
            title={tab.workspacePath ?? tab.name}
          >
            {/* Folder icon */}
            <svg className="project-tab-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
            </svg>

            {editingId === tab.id ? (
              <input
                ref={inputRef}
                className="project-tab-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="project-tab-name">{tab.name}</span>
            )}

            {/* Open folder button (when no workspace) */}
            {!tab.workspacePath && (
              <button
                className="project-tab-open-btn"
                title="Open folder for this project"
                onClick={(e) => { e.stopPropagation(); handleOpenFolder(tab.id); }}
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
                </svg>
              </button>
            )}

            {/* Close button */}
            {projectTabs.length > 1 && (
              <button
                className="project-tab-close"
                title="Close project tab"
                onClick={(e) => { e.stopPropagation(); closeProjectTab(tab.id); }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* New tab button */}
      <button
        className="project-tab-new"
        onClick={createProjectTab}
        title="New project tab"
      >
        +
      </button>
    </div>
  );
}
