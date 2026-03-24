import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import "../HistoryPanel/HistoryPanel.css";

export function SkillsPanel() {
  const skills = useEditorStore((s) => s.skills);
  const addSkill = useEditorStore((s) => s.addSkill);
  const removeSkill = useEditorStore((s) => s.removeSkill);

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const handleSave = () => {
    if (!name.trim()) return;
    addSkill({
      id: `skill_${Date.now()}`,
      name: name.trim(),
      description: desc.trim(),
    });
    setName("");
    setDesc("");
    setIsAdding(false);
  };

  return (
    <div className="history-panel" style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)" }}>
      <div className="hp-header" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1px", color: "var(--text-primary)" }}>AGENT SKILLS</span>
        <span style={{ background: "var(--bg-tertiary)", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
          {skills.length}
        </span>
      </div>
      
      <div className="hp-list" style={{ padding: 16, overflowY: "auto", flex: 1 }}>
        {skills.length === 0 && !isAdding && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <svg width="32" height="32" viewBox="0 0 16 16" fill="var(--text-muted)" style={{ marginBottom: 12, opacity: 0.5 }}>
              <path d="M8 1a2 2 0 0 1 2 2v2H6V3a2 2 0 0 1 2-2zm3 4V3a3 3 0 1 0-6 0v2H2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5h-3zm2 8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6h10v7z"/>
            </svg>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
              No skills defined.<br/>Add custom rules or context snippets for the AI agent to follow.
            </p>
          </div>
        )}

        {skills.map(s => (
          <div key={s.id} style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            padding: "14px",
            borderRadius: 8,
            marginBottom: 12,
            position: "relative",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            transition: "all 0.2s"
          }}>
            <div style={{ fontWeight: 600, color: "var(--accent)", fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: "6px" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                 <path d="M8 1.5l6.5 4-6.5 4-6.5-4 6.5-4zm0 9l6.5-4v2.5l-6.5 4-6.5-4v-2.5l6.5 4z"/>
              </svg>
              {s.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {s.description}
            </div>
            <button
              onClick={() => removeSkill(s.id)}
              style={{
                position: "absolute", top: 8, right: 8, background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 16, width: 24, height: 24,
                display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,0,0,0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              title="Remove skill"
            >
              ×
            </button>
          </div>
        ))}

        {isAdding ? (
          <div style={{ background: "var(--bg-tertiary)", padding: 14, borderRadius: 8, marginTop: 16, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "var(--text-primary)" }}>Add New Skill</div>
            <input
              placeholder="Skill Name (e.g. React Expert)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border)", padding: "8px 10px", color: "var(--text-primary)", marginBottom: 8, borderRadius: 6, boxSizing: "border-box", fontSize: 13 }}
              autoFocus
            />
            <textarea
              placeholder="Description or System Prompt rules..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border)", padding: "10px", color: "var(--text-primary)", marginBottom: 12, borderRadius: 6, boxSizing: "border-box", resize: "vertical", fontSize: 13, lineHeight: 1.4 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSave}
                style={{ flex: 1, padding: "8px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
              >
                Save Skill
              </button>
              <button
                onClick={() => setIsAdding(false)}
                style={{ flex: 1, padding: "8px", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            style={{
              marginTop: 16, padding: "10px", background: "transparent", color: "var(--text-primary)",
              border: "1px dashed var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13, width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s"
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 0 1 0 2H9v4a1 1 0 0 1-2 0V9H3a1 1 0 0 1 0-2h4V3a1 1 0 0 1 1-1z"/>
            </svg>
            Add New Skill
          </button>
        )}
      </div>
    </div>
  );
}
