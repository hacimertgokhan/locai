import { FileTree } from "./components/FileTree/FileTree";
import { MonacoEditorPanel } from "./components/Editor/MonacoEditor";
import { AIPanel } from "./components/AIPanel/AIPanel";
import { SettingsModal } from "./components/Settings/Settings";
import { useEditorStore } from "./store/editorStore";
import "./App.css";
import { useEffect } from "react";

export default function App() {
  const showSettings = useEditorStore((s) => s.showSettings);
  const theme = useEditorStore((s) => s.theme);

  // Apply saved theme on mount
  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="app">
      <div className="sidebar">
        <FileTree />
      </div>
      <div className="editor-pane">
        <MonacoEditorPanel />
      </div>
      <div className="ai-pane">
        <AIPanel />
      </div>
      {showSettings && <SettingsModal />}
    </div>
  );
}
