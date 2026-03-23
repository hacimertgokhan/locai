import { FileTree } from "./components/FileTree/FileTree";
import { MonacoEditorPanel } from "./components/Editor/MonacoEditor";
import { AIPanel } from "./components/AIPanel/AIPanel";
import { SettingsModal } from "./components/Settings/Settings";
import { Terminal } from "./components/Terminal/Terminal";
import { GitPanel } from "./components/GitPanel/GitPanel";
import { ActivityBar } from "./components/ActivityBar/ActivityBar";
import { SearchPanel } from "./components/SearchPanel/SearchPanel";
import { HistoryPanel } from "./components/HistoryPanel/HistoryPanel";
import { ProjectTabBar } from "./components/ProjectTabs/ProjectTabBar";
import { useEditorStore } from "./store/editorStore";
import "./App.css";
import { useEffect, useCallback } from "react";

import { SkillsPanel } from "./components/Sidebar/SkillsPanel";
import { MCPPanel } from "./components/Sidebar/MCPPanel";

// ── Sidebar content based on active view ─────────────────────────
function SidebarContent() {
  const sidebarView = useEditorStore((s) => s.sidebarView);

  switch (sidebarView) {
    case "git": return <GitPanel />;
    case "search": return <SearchPanel />;
    case "history": return <HistoryPanel />;
    case "skills": return <SkillsPanel />;
    case "mcp": return <MCPPanel />;
    default: return <FileTree />;
  }
}

// ── Editor pane with collapsible terminal ─────────────────────────
function EditorPane() {
  const terminalOpen = useEditorStore((s) => s.terminalOpen);
  const setTerminalOpen = useEditorStore((s) => s.setTerminalOpen);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setTerminalOpen(!terminalOpen);
      }
    },
    [terminalOpen, setTerminalOpen]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="editor-pane">
      <div className="editor-area">
        <MonacoEditorPanel />
      </div>

      {/* Terminal toggle button */}
      <button
        className={`terminal-toggle-btn ${terminalOpen ? "active" : ""}`}
        onClick={() => setTerminalOpen(!terminalOpen)}
        title="Toggle Terminal (Ctrl+`)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z"/>
          <path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z"/>
        </svg>
        Terminal
      </button>

      {terminalOpen && (
        <div className="terminal-container animate-slide-up">
          <Terminal />
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────
export default function App() {
  const showSettings = useEditorStore((s) => s.showSettings);
  const theme = useEditorStore((s) => s.theme);
  const sidebarVisible = useEditorStore((s) => s.sidebarVisible);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className={`app-shell`}>
      {/* ── Project tab bar — full width across top ── */}
      <div className="project-tab-row">
        <ProjectTabBar />
      </div>

      {/* ── Main content row ── */}
      <div className={`app ${sidebarVisible ? "sidebar-open" : "sidebar-closed"}`}>
        <ActivityBar />
        {sidebarVisible && (
          <div className="sidebar">
            <div className="sidebar-content">
              <SidebarContent />
            </div>
          </div>
        )}
        <EditorPane />
        <div className="ai-pane">
          <AIPanel />
        </div>
      </div>

      {showSettings && <SettingsModal />}
    </div>
  );
}
