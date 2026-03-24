import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { DiffHunk, AgentMessage, LlmStepResult } from "../../types";
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

function EditorToolbar({ editor, activeFile }: { editor: MonacoType.editor.IStandaloneCodeEditor | null, activeFile: any }) {
  const dispatchAITask = useEditorStore(s => s.dispatchAITask);

  if (!activeFile) return null;

  const getSelectionOrFile = () => {
    if (!editor) return "";
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return editor.getModel()?.getValueInRange(selection) || "";
    }
    return editor.getValue();
  };

  const handleAIExplain = () => {
    const text = getSelectionOrFile();
    if (!text) return;
    dispatchAITask(`Please explain the following code from \`${activeFile.name}\`:\n\`\`\`${activeFile.language}\n${text}\n\`\`\``);
  };

  const handleAIRefactor = () => {
    const text = getSelectionOrFile();
    if (!text) return;
    dispatchAITask(`Please refactor and improve this code from \`${activeFile.name}\`:\n\`\`\`${activeFile.language}\n${text}\n\`\`\``);
  };

  const handleFormat = () => {
    if (!editor) return;
    editor.getAction('editor.action.formatDocument')?.run();
  };

  const handleToggleWrap = () => {
    if (!editor) return;
    const current = editor.getRawOptions().wordWrap;
    editor.updateOptions({ wordWrap: current === "on" ? "off" : "on" });
  };

  return (
    <div className="ed-toolbar">
      <div className="ed-toolbar-left">
        <span className="ed-toolbar-lang">{activeFile.language}</span>
      </div>
      <div className="ed-toolbar-right">
        <button className="ed-t-btn" onClick={handleFormat} title="Format Document (Shift+Alt+F)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
        </button>
        <button className="ed-t-btn" onClick={handleToggleWrap} title="Toggle Word Wrap (Alt+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
        </button>
        <div className="ed-t-sep"></div>
        <button className="ed-t-ai" onClick={handleAIExplain}>✨ Explain</button>
        <button className="ed-t-ai" onClick={handleAIRefactor}>✨ Refactor</button>
      </div>
    </div>
  );
}

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
  const settings = useEditorStore((s) => s.settings);
  const provider = useEditorStore((s) => s.provider);
  const selectedModel = useEditorStore((s) => s.selectedModel);
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

  // ── AI Inline Completions ──────────────────────────────────────
  useEffect(() => {
    if (!monacoRef.current || !editorReady || !selectedModel) return;
    const monaco = monacoRef.current;

    const disposable = monaco.languages.registerInlineCompletionsProvider("*", {
      provideInlineCompletions: async (model: MonacoType.editor.ITextModel, position: MonacoType.Position, _context: MonacoType.languages.InlineCompletionContext, token: MonacoType.CancellationToken) => {
        // Debounce
        await new Promise((res) => setTimeout(res, 500));
        if (token.isCancellationRequested) return { items: [] };

        const prefix = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 30),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 30),
          endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 30))
        });

        if (prefix.trim().length < 5) return { items: [] };

        const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;
        const prompt = `<PREFIX>\n${prefix}\n</PREFIX>\n<CURSOR>\n<SUFFIX>\n${suffix}\n</SUFFIX>`;
        const msgs: AgentMessage[] = [
          { role: "system", content: "You are an inline code autocomplete engine. Output ONLY the code that should be inserted exactly at <CURSOR>. No explanations, no markdown blocks." },
          { role: "user", content: prompt }
        ];

        try {
          const res = await invoke<LlmStepResult>("call_llm_step", {
            provider, baseUrl, model: selectedModel, messages: msgs, tools: []
          });
          if (token.isCancellationRequested) return { items: [] };

          if (res.type === "content" && res.content) {
            let text = res.content;
            if (text.startsWith("```")) {
              const lines = text.split("\\n");
              lines.shift();
              if (lines[lines.length - 1] === "```") lines.pop();
              text = lines.join("\\n");
            }
            if (text.trim().length === 0) return { items: [] };

            return {
              items: [{
                insertText: text,
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
              }]
            };
          }
        } catch { }

        return { items: [] };
      },
      freeInlineCompletions() {}
    });

    const codeLensDisposable = monaco.languages.registerCodeLensProvider(["javascript", "typescript", "typescriptreact"], {
      provideCodeLenses: function (model: MonacoType.editor.ITextModel, _token: any) {
        const lenses: MonacoType.languages.CodeLens[] = [];
        const regex = /(app|router)\.(get|post|put|delete|patch)\s*\(/g;
        const text = model.getValue();
        let match;
        while ((match = regex.exec(text)) !== null) {
          const pos = model.getPositionAt(match.index);
          lenses.push({
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            id: `test-endpoint-${pos.lineNumber}`,
            command: {
              id: "test-endpoint-action",
              title: "▶ Test Endpoint",
              tooltip: "Mock an API request to this endpoint",
              arguments: [pos.lineNumber]
            }
          });
        }
        return { lenses, dispose: () => {} };
      },
      resolveCodeLens: function (_model: any, codeLens: any, _token: any) {
        return codeLens;
      }
    });

    return () => {
      disposable.dispose();
      codeLensDisposable.dispose();
    };
  }, [editorReady, provider, selectedModel, settings.ollamaUrl, settings.lmstudioUrl]);

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

    editor.addAction({
      id: "test-endpoint-action",
      label: "Test Endpoint",
      run: async function(ed: any, args: any) {
        try {
          const model = ed.getModel();
          const lineNum = Array.isArray(args) ? args[0] : args;
          const lineContent = model.getLineContent(lineNum).trim();
          
          let method = "GET";
          if (lineContent.includes(".post(")) method = "POST";
          else if (lineContent.includes(".put(")) method = "PUT";
          else if (lineContent.includes(".delete(")) method = "DELETE";
          else if (lineContent.includes(".patch(")) method = "PATCH";

          const routeMatch = lineContent.match(/['"\`](.*?)['"\`]/);
          const route = routeMatch ? routeMatch[1] : "/";

          const curlCmd = `curl -X ${method} http://localhost:3000${route.startsWith("/") ? route : "/" + route}`;
          
          useEditorStore.getState().executeTerminalCommand(curlCmd);
          
          import("@tauri-apps/plugin-dialog").then(({ message }) => {
            message(`Executed: ${curlCmd}\n\nCheck the Terminal panel for the result.`, { title: "Test Endpoint", kind: "info" });
          }).catch(() => {});
        } catch (e) {
          console.error("Endpoint testing error:", e);
        }
      }
    });

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
        <div className="ed-monaco-wrapper">
          <EditorToolbar editor={editorRef.current} activeFile={activeFile} />
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
                fontSize: settings.fontSize,
                fontFamily: `"${settings.fontFamily}", 'JetBrains Mono', monospace`,
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
                codeLens: true,
                padding: { top: 8 },
                scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
                
                // Advanced Syntax & Snippet Support
                quickSuggestions: { other: true, comments: false, strings: true },
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: "smart",
                acceptSuggestionOnCommitCharacter: true,
                snippetSuggestions: "inline",
                parameterHints: { enabled: true },
                suggest: { 
                  showSnippets: true, 
                  showKeywords: true, 
                  showClasses: true, 
                  showVariables: true, 
                  showFunctions: true 
                },
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
