import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModelSelector } from "./ModelSelector";
import { useEditorStore } from "../../store/editorStore";
import { DiffHunk, Theme } from "../../types";
import "./AIPanel.css";

// ── Session list overlay ───────────────────────────────────────────
function SessionList({ onClose }: { onClose: () => void }) {
  const sessions = useEditorStore((s) => s.sessions);
  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const switchSession = useEditorStore((s) => s.switchSession);
  const createSession = useEditorStore((s) => s.createSession);
  const deleteSession = useEditorStore((s) => s.deleteSession);

  return (
    <div className="session-overlay animate-slide-in-right">
      <div className="session-header">
        <span>Sessions</span>
        <button className="ai-icon-btn" onClick={onClose}>✕</button>
      </div>
      <button className="session-new" onClick={createSession}>
        + New session
      </button>
      <div className="session-list">
        {[...sessions].reverse().map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? "active" : ""}`}
            onClick={() => switchSession(s.id)}
          >
            <div className="session-item-name">{s.name}</div>
            <div className="session-item-meta">
              {s.messages.length} msg · {new Date(s.updatedAt).toLocaleDateString("tr-TR")}
            </div>
            <button
              className="session-delete"
              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────
function MessageBubble({
  role, content, hunks, modifiedContent, filePath
}: {
  role: "user" | "assistant"; content: string; hunks?: DiffHunk[]; modifiedContent?: string; filePath?: string;
}) {
  const setDiff = useEditorStore((s) => s.setDiff);

  const handleViewDiff = () => {
    if (hunks && modifiedContent) {
      setDiff(hunks, modifiedContent);
    }
  };

  return (
    <div className={`msg msg-${role} animate-slide-up`}>
      <div className="msg-role">{role === "user" ? "you" : "ai"}</div>
      <div className="msg-body">
        {filePath && <div className="msg-file">{filePath.split("/").pop()}</div>}
        <p className="msg-text">{content}</p>
        {hunks && hunks.length > 0 && (
          <div className="msg-hunks">
            {hunks.map((h) => (
              <div key={h.id} className={`msg-hunk msg-hunk-${h.kind.toLowerCase()}`}>
                <span className="msg-hunk-kind">{h.kind}</span>
                <span className="msg-hunk-loc">line {h.oldStart}</span>
              </div>
            ))}
            {modifiedContent && (
              <button className="msg-view-diff" onClick={handleViewDiff}>
                view in editor
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Theme switcher ────────────────────────────────────────────────
function ThemeSwitcher() {
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const themes: Theme[] = ["dark", "grey", "light"];
  return (
    <div className="theme-switcher">
      {themes.map((t) => (
        <button
          key={t}
          className={`theme-btn ${theme === t ? "active" : ""}`}
          onClick={() => setTheme(t)}
          title={t}
        />
      ))}
    </div>
  );
}

// ── Main AI Panel ──────────────────────────────────────────────────
export function AIPanel() {
  const [prompt, setPrompt] = useState("");
  const [showSess, setShowSess] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const provider = useEditorStore((s) => s.provider);
  const selectedModel = useEditorStore((s) => s.selectedModel);
  const settings = useEditorStore((s) => s.settings);
  const isStreaming = useEditorStore((s) => s.isStreaming);
  const setIsStreaming = useEditorStore((s) => s.setIsStreaming);
  const streamBuffer = useEditorStore((s) => s.streamBuffer);
  const appendStream = useEditorStore((s) => s.appendStream);
  const clearStream = useEditorStore((s) => s.clearStream);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const setDiff = useEditorStore((s) => s.setDiff);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const addMessage = useEditorStore((s) => s.addMessage);
  const activeSession = useEditorStore((s) => s.activeSession)();
  const isDiffMode = useEditorStore((s) => s.isDiffMode);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const handleSend = async () => {
    if (!prompt.trim() || !selectedModel || !activeFile || isStreaming) return;

    const userPrompt = prompt.trim();
    setPrompt("");
    clearStream();
    setIsStreaming(true);
    setDiff([], "");

    // Save user message
    addMessage({
      id: `m_${Date.now()}`,
      role: "user",
      content: userPrompt,
      filePath: activeFile.path,
      timestamp: Date.now(),
    });

    const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;

    const unlistenChunk = await listen<string>("llm-chunk", (ev) => appendStream(ev.payload));

    const unlistenDone = await listen<string>("llm-done", async (ev) => {
      const modified = ev.payload;
      unlistenChunk();
      unlistenDone();

      let hunks: DiffHunk[] = [];
      try {
        hunks = await invoke<DiffHunk[]>("compute_diff", {
          original: activeFile.content,
          modified,
        });
        setDiff(hunks, modified);
      } catch (e) {
        console.error("Diff failed:", e);
      }

      // Save assistant message
      addMessage({
        id: `m_${Date.now()}`,
        role: "assistant",
        content: hunks.length > 0
          ? `Applied ${hunks.length} change${hunks.length !== 1 ? "s" : ""}`
          : "No changes needed.",
        hunks,
        modifiedContent: hunks.length > 0 ? modified : undefined,
        filePath: activeFile.path,
        timestamp: Date.now(),
      });

      clearStream();
      setIsStreaming(false);
    });

    try {
      await invoke("stream_llm", {
        provider,
        baseUrl,
        model: selectedModel,
        fileContent: activeFile.content,
        filePath: activeFile.path,
        userPrompt,
      });
    } catch (e: any) {
      unlistenChunk();
      unlistenDone();
      addMessage({
        id: `m_${Date.now()}`,
        role: "assistant",
        content: `Error: ${e}`,
        timestamp: Date.now(),
      });
      clearStream();
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [prompt]);

  return (
    <div className="ai-panel">
      {/* Header */}
      <div className="ai-header">
        <span className="ai-title">locai</span>
        <div className="ai-header-actions">
          <ThemeSwitcher />
          <button className="ai-icon-btn" onClick={() => setShowSess(!showSess)} title="Sessions">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2zm1 0v12h10V2H3z"/>
              <path d="M5 4h6v1H5V4zm0 2h6v1H5V6zm0 2h4v1H5V8z"/>
            </svg>
          </button>
          <button className="ai-icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.474l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Session list overlay */}
      {showSess && <SessionList onClose={() => setShowSess(false)} />}

      {/* Model selector */}
      <ModelSelector />

      {/* Messages */}
      <div className="ai-messages">
        {messages.length === 0 && !isStreaming && !streamBuffer && (
          <div className="ai-empty">
            <div className="ai-empty-text">
              {activeFile
                ? `editing ${activeFile.name}`
                : "open a file to start"}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            hunks={m.hunks}
            modifiedContent={m.modifiedContent}
            filePath={m.filePath}
          />
        ))}
        {/* Streaming indicator */}
        {isStreaming && (
          <div className="msg msg-assistant animate-fade-in">
            <div className="msg-role">ai</div>
            <div className="msg-body">
              <div className="streaming-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Diff status */}
      {isDiffMode && !isStreaming && (
        <div className="ai-diff-status animate-slide-up">
          <span className="ai-diff-pulse" />
          <span>{useEditorStore.getState().diffHunks.length} changes waiting</span>
          <span className="ai-diff-hint">Accept or reject in editor</span>
        </div>
      )}

      {/* Context badge */}
      {activeFile && (
        <div className="ai-ctx">
          <span className="ai-ctx-name">{activeFile.name}</span>
          <span className="ai-ctx-sep">·</span>
          <span className="ai-ctx-lines">{activeFile.content.split("\n").length} lines</span>
        </div>
      )}

      {/* Prompt */}
      <div className="ai-input-area">
        <textarea
          ref={textareaRef}
          className="ai-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            activeFile
              ? "describe the changes… (↵ send)"
              : "open a file first"
          }
          disabled={!activeFile || isStreaming}
          rows={1}
        />
        <button
          className={`ai-send ${isStreaming ? "sending" : ""}`}
          onClick={handleSend}
          disabled={!activeFile || !selectedModel || !prompt.trim() || isStreaming}
        >
          {isStreaming ? <span className="ai-spin">⟳</span> : "↑"}
        </button>
      </div>
    </div>
  );
}
