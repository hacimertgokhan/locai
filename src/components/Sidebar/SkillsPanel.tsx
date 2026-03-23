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
    <div className="history-panel">
      <div className="hp-header">
        <span className="hp-title">AGENT SKILLS</span>
        <span className="hp-count">{skills.length}</span>
      </div>
      <div className="hp-list" style={{ padding: 12 }}>
        {skills.length === 0 && !isAdding && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            No skills defined. Add custom rules or context snippets for the AI.
          </p>
        )}

        {skills.map(s => (
          <div key={s.id} style={{
            background: "var(--bg-primary)", padding: 8, borderRadius: 4,
            marginBottom: 8, position: "relative"
          }}>
            <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 12, marginBottom: 4 }}>
              {s.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
              {s.description}
            </div>
            <button
              onClick={() => removeSkill(s.id)}
              style={{
                position: "absolute", top: 4, right: 4, background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 14
              }}
              title="Remove skill"
            >×</button>
          </div>
        ))}

        {isAdding ? (
          <div style={{ background: "var(--bg-primary)", padding: 8, borderRadius: 4, marginTop: 10 }}>
            <input
              placeholder="Skill Name (e.g. React Expert)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", padding: 6, color: "#fff", marginBottom: 6, borderRadius: 2 }}
            />
            <textarea
              placeholder="Description or System Prompt rules..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", padding: 6, color: "#fff", marginBottom: 6, borderRadius: 2, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleSave}
                style={{ flex: 1, padding: "6px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
              >
                Save
              </button>
              <button
                onClick={() => setIsAdding(false)}
                style={{ flex: 1, padding: "6px 12px", background: "var(--bg-tertiary)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            style={{
              marginTop: 15, padding: "6px 12px", background: "var(--bg-tertiary)", color: "var(--text-primary)",
              border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", fontSize: 13, width: "100%"
            }}
          >
            + Add Skill
          </button>
        )}
      </div>
    </div>
  );
}
