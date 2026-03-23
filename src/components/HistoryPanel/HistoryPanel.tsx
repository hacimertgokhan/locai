import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { PromptHistoryEntry } from "../../types";
import "./HistoryPanel.css";

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DiffViewer({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const rows: { type: "same" | "add" | "del"; line: string }[] = [];

  // Simple line-diff via LCS-like approach (unified)
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  let bi = 0, ai = 0;
  while (bi < beforeLines.length || ai < afterLines.length) {
    const b = beforeLines[bi];
    const a = afterLines[ai];
    if (b === a) {
      rows.push({ type: "same", line: b });
      bi++; ai++;
    } else if (b !== undefined && !afterSet.has(b)) {
      rows.push({ type: "del", line: b });
      bi++;
    } else if (a !== undefined && !beforeSet.has(a)) {
      rows.push({ type: "add", line: a });
      ai++;
    } else {
      if (b !== undefined) rows.push({ type: "del", line: b });
      if (a !== undefined) rows.push({ type: "add", line: a });
      bi++; ai++;
    }
  }

  const changed = rows.filter(r => r.type !== "same");
  if (changed.length === 0) return <div className="hp-no-change">No changes</div>;

  // Show only changed lines ± 1 context
  const changedIdx = rows.map((r, i) => r.type !== "same" ? i : -1).filter(i => i >= 0);
  const show = new Set<number>();
  changedIdx.forEach(i => { show.add(i - 1); show.add(i); show.add(i + 1); });

  return (
    <div className="hp-diff">
      {rows.map((row, i) => {
        if (!show.has(i)) return null;
        return (
          <div key={i} className={`hp-diff-line hp-diff-${row.type}`}>
            <span className="hp-diff-prefix">{row.type === "add" ? "+" : row.type === "del" ? "−" : " "}</span>
            <span className="hp-diff-text">{row.line || "\u00a0"}</span>
          </div>
        );
      })}
    </div>
  );
}

function HistoryEntry({ entry, onRestore }: {
  entry: PromptHistoryEntry;
  onRestore: (entry: PromptHistoryEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeFile, setActiveFile] = useState(entry.files[0]?.name ?? "");

  const fileData = entry.files.find(f => f.name === activeFile);

  return (
    <div className="hp-entry">
      <div className="hp-entry-header" onClick={() => setExpanded(!expanded)}>
        <span className="hp-entry-chevron">{expanded ? "▾" : "▸"}</span>
        <div className="hp-entry-info">
          <div className="hp-entry-prompt">{entry.prompt}</div>
          <div className="hp-entry-meta">
            <span>{relTime(entry.timestamp)}</span>
            {entry.files.length > 0 && (
              <span>· {entry.files.length} file{entry.files.length !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="hp-entry-body animate-slide-up">
          {entry.files.length > 1 && (
            <div className="hp-file-tabs">
              {entry.files.map(f => (
                <button
                  key={f.path}
                  className={`hp-file-tab ${f.name === activeFile ? "active" : ""}`}
                  onClick={() => setActiveFile(f.name)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {fileData && (
            <>
              <div className="hp-file-label">{fileData.path.split("/").pop()}</div>
              <DiffViewer before={fileData.beforeContent} after={fileData.afterContent} />
            </>
          )}
          <button className="hp-restore-btn" onClick={() => onRestore(entry)}>
            Restore changes
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryPanel() {
  const promptHistory = useEditorStore((s) => s.promptHistory);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setDiff = useEditorStore((s) => s.setDiff);
  const openFiles = useEditorStore((s) => s.openFiles);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const [viewMode, setViewMode] = useState<"project" | "global">("project");

  const filtered = viewMode === "project" && workspacePath
    ? promptHistory.filter(e => e.workspacePath === workspacePath)
    : promptHistory;

  const handleRestore = (entry: PromptHistoryEntry) => {
    const firstFile = entry.files[0];
    if (!firstFile || firstFile.hunks.length === 0) return;
    const open = openFiles.find(f => f.path === firstFile.path);
    if (open) {
      setActiveFile(firstFile.path);
      setDiff(firstFile.hunks, firstFile.afterContent);
    }
  };

  return (
    <div className="history-panel">
      <div className="hp-header">
        <span className="hp-title">PROMPT HISTORY</span>
        <span className="hp-count">{filtered.length}</span>
      </div>
      <div style={{ display: "flex", gap: "2px", padding: "0 10px 10px 10px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => setViewMode("project")}
          style={{
            flex: 1, padding: "4px 0", fontSize: 11, cursor: "pointer",
            background: viewMode === "project" ? "var(--bg-primary)" : "transparent",
            color: viewMode === "project" ? "var(--text-primary)" : "var(--text-muted)",
            border: "1px solid",
            borderColor: viewMode === "project" ? "var(--border)" : "transparent",
            borderRadius: 4
          }}
        >
          Project
        </button>
        <button
          onClick={() => setViewMode("global")}
          style={{
            flex: 1, padding: "4px 0", fontSize: 11, cursor: "pointer",
            background: viewMode === "global" ? "var(--bg-primary)" : "transparent",
            color: viewMode === "global" ? "var(--text-primary)" : "var(--text-muted)",
            border: "1px solid",
            borderColor: viewMode === "global" ? "var(--border)" : "transparent",
            borderRadius: 4
          }}
        >
          Global
        </button>
      </div>
      <div className="hp-list">
        {filtered.length === 0 && (
          <div className="hp-empty">No history yet. Make some AI edits!</div>
        )}
        {filtered.map(e => (
          <HistoryEntry key={e.id} entry={e} onRestore={handleRestore} />
        ))}
      </div>
    </div>
  );
}
