import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { Theme } from "../../types";
import "./Settings.css";

export function SettingsModal() {
  const settings = useEditorStore((s) => s.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);

  const [activeTab, setActiveTab] = useState<"general" | "ai" | "appearance">("general");

  // Local state
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [lmstudioUrl, setLmstudioUrl] = useState(settings.lmstudioUrl);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [fontSize, setFontSize] = useState(settings.fontSize.toString());
  const [sessionTheme, setSessionTheme] = useState<Theme>(theme);

  const handleSave = () => {
    updateSettings({
      ollamaUrl,
      lmstudioUrl,
      fontFamily: fontFamily.trim() || "Outfit",
      fontSize: parseInt(fontSize, 10) || 14,
    });
    if (sessionTheme !== theme) {
      setTheme(sessionTheme);
    }
    setShowSettings(false);
  };

  const themes: Theme[] = ["dark", "grey", "light"];

  return (
    <div className="s-overlay" onClick={() => setShowSettings(false)}>
      <div className="s-modal modern-s-modal" onClick={(e) => e.stopPropagation()}>
        <div className="s-header">
          <span>Settings</span>
          <button className="s-close" onClick={() => setShowSettings(false)}>✕</button>
        </div>

        <div className="s-content-wrapper">
          <div className="s-sidebar">
            <button
              className={`s-tab-btn ${activeTab === "general" ? "active" : ""}`}
              onClick={() => setActiveTab("general")}
            >
              General
            </button>
            <button
              className={`s-tab-btn ${activeTab === "appearance" ? "active" : ""}`}
              onClick={() => setActiveTab("appearance")}
            >
              Appearance
            </button>
            <button
              className={`s-tab-btn ${activeTab === "ai" ? "active" : ""}`}
              onClick={() => setActiveTab("ai")}
            >
              AI Models
            </button>
          </div>

          <div className="s-body">
            {activeTab === "general" && (
              <div className="animate-fade-in">
                <div className="s-section">
                  <div className="s-label">Font Family</div>
                  <select className="s-input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                    <option value="Outfit">Outfit</option>
                    <option value="Inter">Inter</option>
                    <option value="Roboto">Roboto</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="system-ui">System Default (system-ui)</option>
                    <option value="sans-serif">Sans Serif</option>
                    <option value="monospace">Monospace</option>
                  </select>
                  <div className="s-hint">Applies to UI and Editor if monaco supports it</div>
                </div>
                <div className="s-section">
                  <div className="s-label">Editor Font Size</div>
                  <input className="s-input" type="number" min="8" max="32" value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
                  <div className="s-hint">Default: 14</div>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="animate-fade-in">
                <div className="s-section">
                  <div className="s-label">Color Theme</div>
                  <div className="s-theme-cards">
                    {themes.map((t) => (
                      <div 
                        key={t}
                        className={`s-theme-card ${sessionTheme === t ? "active" : ""}`}
                        onClick={() => setSessionTheme(t)}
                      >
                        <div className={`theme-preview theme-${t}`} />
                        <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="s-hint">Select the overall application color scheme.</div>
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <div className="animate-fade-in">
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
            )}
          </div>
        </div>

        <div className="s-footer">
          <button className="s-cancel" onClick={() => setShowSettings(false)}>Cancel</button>
          <button className="s-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
