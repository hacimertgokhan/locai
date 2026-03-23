import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore, nextLineId } from "../../store/editorStore";
import "./Terminal.css";

// ── Single terminal session view ───────────────────────────────────
function TerminalPane({ sessionId }: { sessionId: string }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const terminalSessions = useEditorStore((s) => s.terminalSessions);
  const session = terminalSessions.find((s) => s.id === sessionId);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const appendTerminalLine = useEditorStore((s) => s.appendTerminalLine);
  const setTerminalRunning = useEditorStore((s) => s.setTerminalRunning);
  const setTerminalCwd = useEditorStore((s) => s.setTerminalCwd);
  const pushTerminalHistory = useEditorStore((s) => s.pushTerminalHistory);
  const setTerminalHistoryIdx = useEditorStore((s) => s.setTerminalHistoryIdx);
  const clearTerminalLines = useEditorStore((s) => s.clearTerminalLines);

  const cwd = session?.cwd ?? workspacePath ?? "/";
  const running = session?.running ?? false;
  const lines = session?.lines ?? [];
  const history = session?.history ?? [];
  const historyIdx = session?.historyIdx ?? -1;

  useEffect(() => { inputRef.current?.focus(); }, [sessionId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const runCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    pushTerminalHistory(sessionId, trimmed);
    appendTerminalLine(sessionId, { id: nextLineId(), text: `$ ${trimmed}`, stream: "input" });

    // Built-ins
    if (trimmed.startsWith("cd ")) {
      const target = trimmed.slice(3).trim();
      let newPath = target.startsWith("/") ? target : `${cwd}/${target}`;
      // Normalize path
      try {
        await invoke("read_dir_shallow", { path: newPath });
        setTerminalCwd(sessionId, newPath);
      } catch {
        appendTerminalLine(sessionId, { id: nextLineId(), text: `cd: no such directory: ${target}`, stream: "stderr" });
      }
      return;
    }
    if (trimmed === "clear" || trimmed === "cls") {
      clearTerminalLines(sessionId);
      return;
    }

    setTerminalRunning(sessionId, true);

    const unlistenOutput = await listen<{ session_id: string; text: string; stream: string }>(
      "terminal-output",
      (ev) => {
        if (ev.payload.session_id !== sessionId) return;
        appendTerminalLine(sessionId, {
          id: nextLineId(),
          text: ev.payload.text,
          stream: ev.payload.stream as "stdout" | "stderr",
        });
      }
    );

    const unlistenDone = await listen<{ session_id: string; code: number }>(
      "terminal-done",
      (ev) => {
        if (ev.payload.session_id !== sessionId) return;
        unlistenOutput();
        unlistenDone();
        if (ev.payload.code !== 0) {
          appendTerminalLine(sessionId, {
            id: nextLineId(),
            text: `[exited ${ev.payload.code}]`,
            stream: "system",
          });
        }
        setTerminalRunning(sessionId, false);
      }
    );

    try {
      await invoke("run_terminal_command", { sessionId, cmd: trimmed, cwd });
    } catch (e: any) {
      unlistenOutput();
      unlistenDone();
      appendTerminalLine(sessionId, { id: nextLineId(), text: `Error: ${e}`, stream: "stderr" });
      setTerminalRunning(sessionId, false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const cmd = input;
      setInput("");
      runCommand(cmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setTerminalHistoryIdx(sessionId, idx);
      setInput(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setTerminalHistoryIdx(sessionId, idx);
      setInput(idx === -1 ? "" : (history[idx] ?? ""));
    }
  };

  const shortCwd = cwd.length > 30 ? "…" + cwd.slice(-29) : cwd;

  return (
    <div className="terminal-pane" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-output">
        {lines.map((line) => (
          <div key={line.id} className={`terminal-line terminal-${line.stream}`}>
            {line.text || "\u00a0"}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt">
          <span className="terminal-cwd">{shortCwd}</span>
          <span className="terminal-arrow">{running ? "⟳" : "❯"}</span>
        </span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}

// ── Multi-tab terminal panel ───────────────────────────────────────
export function Terminal() {
  const terminalSessions = useEditorStore((s) => s.terminalSessions);
  const activeTerminalId = useEditorStore((s) => s.activeTerminalId);
  const switchTerminalSession = useEditorStore((s) => s.switchTerminalSession);
  const createTerminalSession = useEditorStore((s) => s.createTerminalSession);
  const closeTerminalSession = useEditorStore((s) => s.closeTerminalSession);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setTerminalCwd = useEditorStore((s) => s.setTerminalCwd);

  // Sync cwd when workspace changes
  useEffect(() => {
    if (!workspacePath) return;
    terminalSessions.forEach(s => {
      if (s.cwd === "/" || s.cwd === "") {
        setTerminalCwd(s.id, workspacePath);
      }
    });
  }, [workspacePath]);

  // Ensure active terminal exists
  const activeExists = terminalSessions.some(s => s.id === activeTerminalId);
  useEffect(() => {
    if (!activeExists && terminalSessions.length > 0) {
      switchTerminalSession(terminalSessions[0].id);
    }
  }, [activeExists, terminalSessions]);

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs" style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex", overflowX: "auto", flex: 1, scrollbarWidth: "none" }}>
          {terminalSessions.map((s) => (
            <div
              key={s.id}
              className={`terminal-tab ${s.id === activeTerminalId ? "active" : ""}`}
              onClick={() => switchTerminalSession(s.id)}
            >
              <span className="terminal-tab-name">{s.name}</span>
              {terminalSessions.length > 1 && (
                <button
                  className="terminal-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTerminalSession(s.id); }}
                  title="Close terminal"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="terminal-new-btn" onClick={createTerminalSession} title="New terminal">
            +
          </button>
        </div>
        <button
          className="terminal-close-btn"
          onClick={() => useEditorStore.getState().setTerminalOpen(false)}
          title="Close (Ctrl+`)"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 12px" }}
        >
          ✕
        </button>
      </div>

      <div className="terminal-body">
        {terminalSessions.map((s) => (
          <div
            key={s.id}
            className="terminal-session-wrap"
            style={{ display: s.id === activeTerminalId ? "flex" : "none" }}
          >
            <TerminalPane sessionId={s.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
