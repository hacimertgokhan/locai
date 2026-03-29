import { useEditorStore } from "../../store/editorStore";
import { X, Plus, Trash2 } from "lucide-react";

export function SessionList({ onClose }: { onClose: () => void }) {
  const sessions = useEditorStore((s) => s.sessions);
  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const switchSession = useEditorStore((s) => s.switchSession);
  const createSession = useEditorStore((s) => s.createSession);
  const deleteSession = useEditorStore((s) => s.deleteSession);

  const workspacePath = useEditorStore((s) => s.workspacePath);
  const projectSessions = sessions.filter(s => s.workspacePath === workspacePath);

  return (
    <div className="session-overlay animate-slide-in-right">
      <div className="session-header">
        <span>Project Sessions</span>
        <button className="ai-icon-btn" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <button className="session-new flex flex-row items-center" onClick={createSession}>
        <Plus size={14} style={{ marginRight: 6 }} />
        NEW SESSION
      </button>
      <div className="session-list">
        {[...projectSessions].reverse().map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? "active" : ""}`}
            onClick={() => switchSession(s.id)}
          >
            <div className="session-item-name">{s.name}</div>
            <div className="session-item-meta">
              {s.messages.length} messages · {new Date(s.updatedAt).toLocaleDateString("en-US")}
            </div>
            <button
              className="session-delete"
              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
