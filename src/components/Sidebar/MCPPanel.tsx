import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import "../HistoryPanel/HistoryPanel.css";

export function MCPPanel() {
  const mcpServers = useEditorStore((s) => s.mcpServers);
  const addMCPServer = useEditorStore((s) => s.addMCPServer);
  const removeMCPServer = useEditorStore((s) => s.removeMCPServer);

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    addMCPServer({
      id: `mcp_${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
    });
    setName("");
    setUrl("");
    setIsAdding(false);
  };

  return (
    <div className="history-panel">
      <div className="hp-header">
        <span className="hp-title">MCP SERVERS</span>
        <span className="hp-count">{mcpServers.length}</span>
      </div>
      <div className="hp-list" style={{ padding: 12 }}>
        {mcpServers.length === 0 && !isAdding && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            No MCP servers integrated. Add external tools (GitHub, Linear, Postgres, etc).
          </p>
        )}

        {mcpServers.map(s => (
          <div key={s.id} style={{
            background: "var(--bg-primary)", padding: 8, borderRadius: 4,
            marginBottom: 8, position: "relative"
          }}>
            <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 12, marginBottom: 4 }}>
              {s.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
              {s.url}
            </div>
            <button
              onClick={() => removeMCPServer(s.id)}
              style={{
                position: "absolute", top: 4, right: 4, background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 14
              }}
              title="Remove server"
            >×</button>
          </div>
        ))}

        {isAdding ? (
          <div style={{ background: "var(--bg-primary)", padding: 8, borderRadius: 4, marginTop: 10 }}>
            <input
              placeholder="Server Name (e.g. Postgres DB)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", padding: 6, color: "#fff", marginBottom: 6, borderRadius: 2 }}
            />
            <input
              placeholder="Command or URL (e.g. npx -y @modelcontextprotocol/server-postgres postgres://...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", padding: 6, color: "#fff", marginBottom: 6, borderRadius: 2 }}
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
            + Add MCP Server
          </button>
        )}
      </div>
    </div>
  );
}
