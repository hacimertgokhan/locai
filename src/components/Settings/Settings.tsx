import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import "./Settings.css";

export function SettingsModal() {
  const settings = useEditorStore((s) => s.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);

  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [lmstudioUrl, setLmstudioUrl] = useState(settings.lmstudioUrl);

  return (
    <div className="s-overlay" onClick={() => setShowSettings(false)}>
      <div className="s-modal" onClick={(e) => e.stopPropagation()}>
        <div className="s-header">
          <span>Settings</span>
          <button className="s-close" onClick={() => setShowSettings(false)}>✕</button>
        </div>
        <div className="s-body">
          <div className="s-section">
            <div className="s-label">Ollama URL</div>
            <input className="s-input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
            <div className="s-hint">Default: http://localhost:11434</div>
          </div>
          <div className="s-section">
            <div className="s-label">LM Studio URL</div>
            <input className="s-input" value={lmstudioUrl} onChange={(e) => setLmstudioUrl(e.target.value)} />
            <div className="s-hint">Default: http://localhost:1234</div>
          </div>
        </div>
        <div className="s-footer">
          <button className="s-cancel" onClick={() => setShowSettings(false)}>Cancel</button>
          <button className="s-save" onClick={() => { updateSettings({ ollamaUrl, lmstudioUrl }); setShowSettings(false); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
