import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { DiffHunk } from "../../types";
import "./MonacoEditor.css";

const MONACO_THEMES = {
  dark: {
    base: "vs-dark" as const,
    colors: {
      "editor.background": "#0f0f10", "editor.foreground": "#eaeaea",
      "editorLineNumber.foreground": "#4a4a50", "editorLineNumber.activeForeground": "#a1a1aa",
      "editorCursor.foreground": "#d97757", "editor.selectionBackground": "#d9775730",
      "editor.inactiveSelectionBackground": "#d9775718", "editorIndentGuide.background1": "#2a2a2e",
      "editorGutter.background": "#0f0f10", "editorWidget.background": "#1a1a1d",
      "editorWidget.border": "#2a2a2e", "input.background": "#1a1a1d",
      "input.border": "#2a2a2e", "list.activeSelectionBackground": "#d9775720",
      "list.hoverBackground": "#1a1a1d",
    },
  },
  grey: {
    base: "vs-dark" as const,
    colors: {
      "editor.background": "#1b1e23", "editor.foreground": "#f3f4f6",
      "editorLineNumber.foreground": "#4a5568", "editorLineNumber.activeForeground": "#a9b2c0",
      "editorCursor.foreground": "#d97757", "editor.selectionBackground": "#d9775730",
      "editor.inactiveSelectionBackground": "#d9775718", "editorIndentGuide.background1": "#333840",
      "editorGutter.background": "#1b1e23", "editorWidget.background": "#23272c",
      "editorWidget.border": "#333840", "input.background": "#23272c",
      "input.border": "#333840", "list.activeSelectionBackground": "#d9775720",
      "list.hoverBackground": "#23272c",
    },
  },
  light: {
    base: "vs" as const,
    colors: {
      "editor.background": "#ffffff", "editor.foreground": "#111827",
      "editorLineNumber.foreground": "#9ca3af", "editorLineNumber.activeForeground": "#4b5563",
      "editorCursor.foreground": "#ca6242", "editor.selectionBackground": "#ca624225",
      "editor.inactiveSelectionBackground": "#ca624215", "editorIndentGuide.background1": "#e5e7eb",
      "editorGutter.background": "#f3f4f6", "editorWidget.background": "#f3f4f6",
      "editorWidget.border": "#e5e7eb", "input.background": "#ffffff",
      "input.border": "#e5e7eb", "list.activeSelectionBackground": "#ca624218",
      "list.hoverBackground": "#f3f4f6",
    },
  },
};

export function MonacoEditorPanel() {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  // Use deltaDecorations IDs (string[]) — more reliable than collection API
  const decoIdsRef = useRef<string[]>([]);
  const zoneIdsRef = useRef<string[]>([]);

  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const markFileSaved = useEditorStore((s) => s.markFileSaved);
  const closeFile = useEditorStore((s) => s.closeFile);
  const diffHunks = useEditorStore((s) => s.diffHunks);
  const isDiffMode = useEditorStore((s) => s.isDiffMode);
  const acceptAll = useEditorStore((s) => s.acceptAll);
  const rejectAll = useEditorStore((s) => s.rejectAll);
  const theme = useEditorStore((s) => s.theme);
  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const clearDiffDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Remove decorations
    decoIdsRef.current = (editor as any).deltaDecorations(decoIdsRef.current, []);
    // Remove view zones
    editor.changeViewZones((acc) => {
      zoneIdsRef.current.forEach((id) => acc.removeZone(id));
    });
    zoneIdsRef.current = [];
  }, []);

  const applyDiffDecorations = useCallback((hunks: DiffHunk[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    clearDiffDecorations();

    const lineH = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const fontSize = editor.getOption(monaco.editor.EditorOption.fontSize);
    const fontFamily = editor.getOption(monaco.editor.EditorOption.fontFamily);

    // ── Red highlight for deleted/changed lines ──────────────────
    const rawDecos: MonacoType.editor.IModelDeltaDecoration[] = [];
    for (const hunk of hunks) {
      if (hunk.kind === "Remove" || hunk.kind === "Change") {
        const s = Math.min(hunk.oldStart, model.getLineCount());
        const e = Math.min(hunk.oldStart + hunk.oldCount - 1, model.getLineCount());
        rawDecos.push({
          range: new monaco.Range(s, 1, e, model.getLineMaxColumn(e)),
          options: {
            isWholeLine: true,
            // inline styles via linesDecorationsClassName keep working even without injected CSS
            linesDecorationsClassName: "diff-del-gutter",
            className: "diff-del-bg",
            inlineClassName: "diff-del-text",
            overviewRuler: { color: "rgba(241,76,76,0.7)", position: 4 },
            minimap: { color: "rgba(241,76,76,0.5)", position: 1 },
          },
        });
      }
    }
    decoIdsRef.current = (editor as any).deltaDecorations([], rawDecos);

    // ── Green view zones for added/changed lines ─────────────────
    editor.changeViewZones((acc) => {
      for (const hunk of hunks) {
        if ((hunk.kind === "Add" || hunk.kind === "Change") && hunk.newLines.length > 0) {
          const afterLine =
            hunk.kind === "Change"
              ? Math.min(hunk.oldStart + hunk.oldCount - 1, model.getLineCount())
              : Math.max(hunk.oldStart - 1, 0);

          const container = document.createElement("div");
          Object.assign(container.style, {
            background: "rgba(78,201,176,0.10)",
            borderLeft: "3px solid rgba(78,201,176,0.75)",
            boxSizing: "border-box",
            width: "100%",
            overflow: "hidden",
            lineHeight: `${lineH}px`,
            fontSize: `${fontSize}px`,
            fontFamily,
          });

          for (const line of hunk.newLines) {
            const row = document.createElement("div");
            Object.assign(row.style, {
              display: "flex",
              alignItems: "center",
              height: `${lineH}px`,
              boxSizing: "border-box",
            });
            const prefix = document.createElement("span");
            Object.assign(prefix.style, {
              display: "inline-block",
              width: "22px",
              minWidth: "22px",
              textAlign: "center",
              color: "#4ec9b0",
              fontWeight: "700",
              fontSize: "12px",
              flexShrink: "0",
            });
            prefix.textContent = "+";
            const code = document.createElement("span");
            Object.assign(code.style, {
              color: "#4ec9b0",
              whiteSpace: "pre",
              flex: "1",
            });
            code.textContent = line || " ";
            row.appendChild(prefix);
            row.appendChild(code);
            container.appendChild(row);
          }

          const margin = document.createElement("div");
          Object.assign(margin.style, {
            background: "rgba(78,201,176,0.12)",
            width: "100%",
            height: "100%",
          });

          const id = acc.addZone({
            afterLineNumber: afterLine,
            heightInLines: hunk.newLines.length,
            domNode: container,
            marginDomNode: margin,
          });
          zoneIdsRef.current.push(id);
        }
      }
    });

    // Force layout so zones appear immediately
    editor.layout();
  }, [clearDiffDecorations]);

  // Inject minimal CSS for the gutter/background classes (not relying on global injection order)
  useEffect(() => {
    if (document.getElementById("locai-diff-css")) return;
    const el = document.createElement("style");
    el.id = "locai-diff-css";
    el.textContent = `
      .diff-del-bg { background: rgba(241,76,76,0.18) !important; }
      .diff-del-text { opacity: 0.45 !important; text-decoration: line-through !important; text-decoration-color: rgba(241,76,76,0.65) !important; }
      .diff-del-gutter { background: rgba(241,76,76,0.6) !important; width: 3px !important; margin-left: 2px !important; }
    `;
    document.head.appendChild(el);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    try {
      await invoke("write_file", { path: activeFile.path, content: activeFile.content });
      markFileSaved(activeFile.path);
    } catch (e) { console.error("Save failed:", e); }
  }, [activeFile, markFileSaved]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleSave]);

  useEffect(() => {
    if (!editorRef.current || !activeFile) return;
    const model = editorRef.current.getModel();
    if (model && model.getValue() !== activeFile.content) {
      model.setValue(activeFile.content);
    }
  }, [activeFilePath]);

  useEffect(() => {
    if (!editorReady) return;
    if (isDiffMode && diffHunks.length > 0) {
      applyDiffDecorations(diffHunks);
    } else {
      clearDiffDecorations();
    }
  }, [diffHunks, isDiffMode, editorReady, applyDiffDecorations, clearDiffDecorations]);

  useEffect(() => {
    if (!monacoRef.current || !editorReady) return;
    monacoRef.current.editor.setTheme(`locai-${theme}`);
  }, [theme, editorReady]);

  const handleMount = (editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Reset refs for this fresh editor instance
    decoIdsRef.current = [];
    zoneIdsRef.current = [];
    (["dark", "grey", "light"] as const).forEach((t) => {
      monaco.editor.defineTheme(`locai-${t}`, {
        base: MONACO_THEMES[t].base,
        inherit: true,
        rules: [],
        colors: MONACO_THEMES[t].colors,
      });
    });
    monaco.editor.setTheme(`locai-${theme}`);
    // Enable JSX so .tsx files don't get false "'>'" syntax errors
    const tsCompilerOpts: any = {
      jsx: 2 as any, // 2 = React (JsxEmit.React)
      jsxFactory: "React.createElement",
      target: 99 as any, // ESNext
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      allowJs: true,
      checkJs: false,
    };
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(tsCompilerOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(tsCompilerOpts);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    setEditorReady(true);
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

      {activeFile && (
        <div className="ed-monaco">
          {isDiffMode && diffHunks.length > 0 && (
            <div className="ed-inline-diff-bar animate-slide-up">
              <span className="ed-inline-diff-count">
                {diffHunks.length} change{diffHunks.length !== 1 ? "s" : ""}
              </span>
              <button className="ed-inline-accept" onClick={acceptAll}>✓ Accept all</button>
              <button className="ed-inline-reject" onClick={rejectAll}>✗ Reject all</button>
            </div>
          )}
          <Editor
            height="100%"
            language={activeFile.language}
            value={activeFile.content}
            theme={`locai-${theme}`}
            onMount={handleMount}
            onChange={(val) => { if (val !== undefined) updateFileContent(activeFile.path, val); }}
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
