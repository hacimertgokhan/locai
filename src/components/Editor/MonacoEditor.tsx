import { useRef, useEffect, useCallback } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { DiffHunk } from "../../types";
import "./MonacoEditor.css";

// ─── View zone + decoration tracking ───────────────────────────────
interface ViewZoneRef {
  hunkId: number;
  zoneId: string;
}

let decorationCollection: MonacoType.editor.IEditorDecorationsCollection | null = null;
let viewZones: ViewZoneRef[] = [];

function clearDiff(editor: MonacoType.editor.IStandaloneCodeEditor) {
  decorationCollection?.clear();
  editor.changeViewZones((acc) => {
    viewZones.forEach(({ zoneId }) => acc.removeZone(zoneId));
  });
  viewZones = [];
}

function applyDiff(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  monaco: Monaco,
  hunks: DiffHunk[]
) {
  const model = editor.getModel();
  if (!model) return;

  clearDiff(editor);

  // ── Decorations (red = removed lines) ──────────────────────────
  const decorations: MonacoType.editor.IModelDeltaDecoration[] = [];

  for (const hunk of hunks) {
    if (hunk.kind === "Remove" || hunk.kind === "Change") {
      const startLine = Math.min(hunk.oldStart, model.getLineCount());
      const endLine = Math.min(hunk.oldStart + hunk.oldCount - 1, model.getLineCount());
      decorations.push({
        range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
        options: {
          isWholeLine: true,
          className: "diff-del-line",
          overviewRuler: { color: "var(--red)", position: 4 },
          minimap: { color: "var(--red)", position: 1 },
        },
      });
    }
  }

  if (!decorationCollection) {
    decorationCollection = editor.createDecorationsCollection(decorations);
  } else {
    decorationCollection.set(decorations);
  }

  // ── View zones (green = added lines) ───────────────────────────
  editor.changeViewZones((acc) => {
    for (const hunk of hunks) {
      if ((hunk.kind === "Add" || hunk.kind === "Change") && hunk.newLines.length > 0) {
        const afterLine =
          hunk.kind === "Change"
            ? Math.min(hunk.oldStart + hunk.oldCount - 1, model.getLineCount())
            : Math.max(hunk.oldStart - 1, 0);

        const domNode = document.createElement("div");
        domNode.className = "diff-add-zone";

        // Build line elements
        hunk.newLines.forEach((line) => {
          const lineEl = document.createElement("div");
          lineEl.className = "diff-add-line";
          lineEl.textContent = line || " ";
          domNode.appendChild(lineEl);
        });

        const zoneId = acc.addZone({
          afterLineNumber: afterLine,
          heightInLines: hunk.newLines.length,
          domNode,
          marginDomNode: (() => {
            const m = document.createElement("div");
            m.className = "diff-add-margin";
            return m;
          })(),
        });

        viewZones.push({ hunkId: hunk.id, zoneId });
      }
    }
  });
}

// ─── Component ────────────────────────────────────────────────────
export function MonacoEditorPanel() {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const markFileSaved = useEditorStore((s) => s.markFileSaved);
  const closeFile = useEditorStore((s) => s.closeFile);
  const diffHunks = useEditorStore((s) => s.diffHunks);
  const isDiffMode = useEditorStore((s) => s.isDiffMode);
  const acceptHunk = useEditorStore((s) => s.acceptHunk);
  const rejectHunk = useEditorStore((s) => s.rejectHunk);
  const acceptAll = useEditorStore((s) => s.acceptAll);
  const rejectAll = useEditorStore((s) => s.rejectAll);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    try {
      await invoke("write_file", { path: activeFile.path, content: activeFile.content });
      markFileSaved(activeFile.path);
    } catch (e) {
      console.error("Save failed:", e);
    }
  }, [activeFile, markFileSaved]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // Sync editor content when switching files
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;
    const model = editorRef.current.getModel();
    if (model && model.getValue() !== activeFile.content) {
      model.setValue(activeFile.content);
    }
  }, [activeFilePath]);

  // Apply / clear diff decorations + view zones
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    if (isDiffMode && diffHunks.length > 0) {
      applyDiff(editorRef.current, monacoRef.current, diffHunks);
    } else {
      clearDiff(editorRef.current);
    }
  }, [diffHunks, isDiffMode]);

  const handleMount = (
    editor: MonacoType.editor.IStandaloneCodeEditor,
    monaco: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme("locai", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0f0f10",
        "editor.foreground": "#eaeaea",
        "editorLineNumber.foreground": "#4a4a50",
        "editorLineNumber.activeForeground": "#a1a1aa",
        "editorCursor.foreground": "#d97757",
        "editor.selectionBackground": "#d9775730",
        "editor.inactiveSelectionBackground": "#d9775718",
        "editorIndentGuide.background1": "#2a2a2e",
        "editorGutter.background": "#0f0f10",
        "editorWidget.background": "#1a1a1d",
        "editorWidget.border": "#2a2a2e",
        "input.background": "#1a1a1d",
        "input.border": "#2a2a2e",
        "list.activeSelectionBackground": "#d9775720",
        "list.hoverBackground": "#1a1a1d",
      },
    });
    monaco.editor.setTheme("locai");

    // Inject view zone styles
    if (!document.getElementById("locai-diff-styles")) {
      const style = document.createElement("style");
      style.id = "locai-diff-styles";
      style.textContent = `
        .diff-del-line {
          background: rgba(241,76,76,0.13) !important;
          border-left: 2px solid #f14c4c !important;
        }
        .diff-add-zone {
          background: rgba(78,201,176,0.10);
          border-left: 2px solid #4ec9b0;
          font-family: 'JetBrains Mono','Fira Code','Consolas',monospace;
          font-size: 13px;
          line-height: 19px;
          overflow: hidden;
          width: 100%;
          box-sizing: border-box;
        }
        .diff-add-line {
          color: #4ec9b0;
          padding: 0 8px;
          white-space: pre;
          min-height: 19px;
        }
        .diff-add-margin {
          background: rgba(78,201,176,0.18);
          width: 100%;
        }
      `;
      document.head.appendChild(style);
    }
  };

  if (openFiles.length === 0) {
    return (
      <div className="ed-empty">
        <div className="ed-empty-inner">
          <div className="ed-empty-logo">locai</div>
          <div className="ed-empty-sub">local ai code editor</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ed-panel">
      {/* Tab bar */}
      <div className="ed-tabs">
        {openFiles.map((file) => (
          <div
            key={file.path}
            className={`ed-tab ${file.path === activeFilePath ? "ed-tab-active" : ""}`}
            onClick={() => setActiveFile(file.path)}
          >
            {file.isDirty && <span className="ed-tab-dot" />}
            <span className="ed-tab-name">{file.name}</span>
            <button
              className="ed-tab-close"
              onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
            >×</button>
          </div>
        ))}
      </div>

      {/* Diff bar */}
      {isDiffMode && (
        <div className="ed-diff-bar animate-slide-up">
          <div className="ed-diff-info">
            <span className="ed-diff-dot" />
            <span>{diffHunks.length} change{diffHunks.length !== 1 ? "s" : ""} suggested</span>
          </div>
          <div className="ed-diff-actions">
            <button className="ed-diff-accept" onClick={acceptAll}>Accept all</button>
            <button className="ed-diff-reject" onClick={rejectAll}>Reject all</button>
          </div>
        </div>
      )}

      {/* Hunk list */}
      {isDiffMode && diffHunks.length > 0 && (
        <div className="ed-hunks animate-slide-up">
          {diffHunks.map((hunk) => (
            <div key={hunk.id} className="ed-hunk">
              <span className={`ed-hunk-kind kind-${hunk.kind.toLowerCase()}`}>
                {hunk.kind}
              </span>
              <span className="ed-hunk-loc">
                line {hunk.oldStart}
                {hunk.oldCount > 1 ? `–${hunk.oldStart + hunk.oldCount - 1}` : ""}
              </span>
              <span className="ed-hunk-preview">
                {hunk.oldLines[0]?.trim().slice(0, 40)}
              </span>
              <div className="ed-hunk-btns">
                <button className="ed-hunk-acc" onClick={() => acceptHunk(hunk.id)}>✓</button>
                <button className="ed-hunk-rej" onClick={() => rejectHunk(hunk.id)}>✗</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Monaco */}
      {activeFile && (
        <div className="ed-monaco">
          <Editor
            height="100%"
            language={activeFile.language}
            value={activeFile.content}
            theme="locai"
            onMount={handleMount}
            onChange={(val) => {
              if (val !== undefined) updateFileContent(activeFile.path, val);
            }}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
              fontLigatures: true,
              lineHeight: 19,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: "off",
              automaticLayout: true,
              tabSize: 2,
              renderWhitespace: "selection",
              smoothScrolling: true,
              cursorBlinking: "smooth",
              bracketPairColorization: { enabled: true },
              renderLineHighlight: "line",
              lineNumbers: "on",
              glyphMargin: true,
              folding: true,
              padding: { top: 8 },
              scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
            }}
          />
        </div>
      )}
    </div>
  );
}
