import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ModelSelector } from "./ModelSelector";
import { AgentStepList } from "./AgentSteps";
import { useEditorStore } from "../../store/editorStore";
import { AgentMessage, AgentStep, AgentToolCall, DiffHunk, FileEntry, LlmStepResult, SearchMatch, Theme } from "../../types";
import "./AIPanel.css";

// ── File path detection ───────────────────────────────────────────
// Matches: ./app/page.tsx  app/page.tsx  components/Foo.tsx  etc.
const FILE_PATTERN = /(?:^|[\s"'`(,])(\.{0,2}\/[^\s"'`),]+\.[a-zA-Z]{1,10}|[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-.]+)+\.[a-zA-Z]{1,10})(?:$|[\s"'`),])/g;

function detectFilePaths(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_PATTERN.lastIndex = 0;
  while ((m = FILE_PATTERN.exec(text)) !== null) {
    let p = m[1];
    // Normalize: strip leading ./
    if (p.startsWith("./")) p = p.slice(2);
    // Skip parent traversals and very short matches
    if (!p || p.startsWith("..") || !p.includes(".") || p.length < 4) continue;
    found.add(p);
  }
  return Array.from(found);
}

// AGENT_TOOLS is no longer sent to the API (local models often ignore them).
// Instead we embed the tool protocol in the system prompt and parse XML responses.
// This ensures compatibility with all local LLMs (Ollama, LM Studio, etc.)
const TOOL_NAMES = ["read_file", "write_file", "delete_file", "rename_file", "create_directory", "run_command", "search_files"];

// ── Agent system prompt — XML tool protocol ────────────────────────
function buildAgentSystemPrompt(workspacePath: string, isBootstrap = false): string {
  const toolDocs = `
Available tools — call them using this EXACT XML format:

<TOOL name="read_file">{"path": "absolute/or/relative/path"}</TOOL>
<TOOL name="write_file">{"path": "some/file.ts", "content": "full file content here"}</TOOL>
<TOOL name="delete_file">{"path": "some/file.ts"}</TOOL>
<TOOL name="rename_file">{"from": "old/path", "to": "new/path"}</TOOL>
<TOOL name="create_directory">{"path": "some/dir"}</TOOL>
<TOOL name="run_command">{"command": "npm install"}</TOOL>
<TOOL name="search_files">{"query": "some text", "case_sensitive": false}</TOOL>

RULES:
- You are not a regular chatbot, DO NOT complain that you cannot interact with files or the system. You HAVE FULL CAPABILITY to read, write, and execute commands via the XML tools.
- Never use phrases like "I cannot directly interact", "I will simulate", or "Here is the resulting code for you to manually apply". YOU MUST USE THE TOOLS.
- Use one <TOOL> per action. You may use multiple tools in one reply.
- After each reply that contains tools, you will receive the results.
- When you have NO more tools to call and the task is complete, write a summary WITHOUT any <TOOL> tags.
- Always read a file before editing it.
- Respond in the same language the user used (Turkish, English, etc.).
- Never truncate file content in write_file — always write the complete file.`;

  if (isBootstrap) {
    return `You are an autonomous coding agent inside a local AI code editor (locai).
Working directory (PARENT folder): ${workspacePath}
${toolDocs}

PROJECT CREATION MODE — no existing project is open.
You must:
1. Create a subdirectory for the new project inside ${workspacePath} using create_directory.
2. Run all setup commands (e.g. npx create-react-app my-app --yes) inside that subdirectory via run_command. ALWAYS use --yes / --no-interactive flags.
3. When completely done, write a final summary (no <TOOL> tags) whose VERY LAST LINE is exactly:
PROJECT_PATH: <absolute path to the project root>`;
  }

  return `You are an autonomous coding agent inside a local AI code editor (locai).
Working directory: ${workspacePath}
${toolDocs}`;
}

// ── Parse <TOOL name="...">args</TOOL> blocks from LLM text ────────
interface ParsedTool {
  id: string;
  name: string;
  argsRaw: string;
  args: Record<string, unknown>;
}

function parseToolCalls(text: string): ParsedTool[] {
  const results: ParsedTool[] = [];
  // Match <TOOL name="...">...</TOOL> — content can span multiple lines
  const re = /<TOOL\s+name=["']([\w_]+)["']>([\.\s\S]*?)<\/TOOL>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const argsRaw = m[2].trim();
    if (!TOOL_NAMES.includes(name)) continue;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsRaw); } catch { /* keep empty */ }
    results.push({ id: `t_${Date.now()}_${idx++}`, name, argsRaw, args });
  }
  return results;
}

// ── Strip <TOOL> blocks from text (for display) ────────────────────
function stripToolBlocks(text: string): string {
  return text.replace(/<TOOL\s+name=["'][\w_]+["']>[\.\s\S]*?<\/TOOL>/gi, "").trim();
}

// ── Agent plan system prompt ───────────────────────────────────────
function buildPlanSystemPrompt(workspacePath: string): string {
  return `You are a planning assistant for a code editor. Workspace: ${workspacePath}

Given a task, produce a numbered step-by-step plan.
Each step should be one concrete action (read a file, write a file, run a command, etc.).
Keep steps short and specific. Do NOT execute anything — only plan.
Respond in the same language the user used.`;
}

// ── Execute a single tool call ────────────────────────────────────
async function executeToolCall(
  call: AgentToolCall,
  workspacePath: string,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(call.function.arguments); } catch { /* keep empty */ }

  const resolve = (p: string) =>
    p.startsWith("/") ? p : `${workspacePath}/${p.replace(/^\.\//, "")}`;

  try {
    switch (call.function.name) {
      case "read_file":
        return (await invoke<string>("read_file", { path: resolve(args.path as string) })).slice(0, 12000);

      case "write_file":
        return await invoke<string>("agent_write_file", {
          path: resolve(args.path as string),
          content: args.content as string,
        });

      case "delete_file":
        return await invoke<string>("agent_delete_path", { path: resolve(args.path as string) });

      case "rename_file":
        return await invoke<string>("agent_rename_path", {
          from: resolve(args.from as string),
          to: resolve(args.to as string),
        });

      case "create_directory":
        return await invoke<string>("agent_create_dir", { path: resolve(args.path as string) });

      case "run_command":
        return await invoke<string>("agent_run_command", {
          cwd: workspacePath,
          command: args.command as string,
        });

      case "search_files": {
        const matches = await invoke<SearchMatch[]>("search_in_files", {
          root: workspacePath,
          query: args.query as string,
          caseSensitive: (args.case_sensitive as boolean) ?? false,
        });
        if (matches.length === 0) return "No matches found.";
        return matches
          .slice(0, 30)
          .map((m) => `${m.file}:${m.lineNum}: ${m.text.trim()}`)
          .join("\n");
      }

      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (e: unknown) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Session list overlay ───────────────────────────────────────────
function SessionList({ onClose }: { onClose: () => void }) {
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
        <button className="ai-icon-btn" onClick={onClose}>✕</button>
      </div>
      <button className="session-new" onClick={createSession}>
        + New session
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
  role, content, hunks, modifiedContent, filePath, agentSteps,
}: {
  role: "user" | "assistant";
  content: string;
  hunks?: DiffHunk[];
  modifiedContent?: string;
  filePath?: string;
  agentSteps?: AgentStep[];
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
        {/* Agent steps (collapsed after completion) */}
        {agentSteps && agentSteps.length > 0 && (
          <AgentStepList steps={agentSteps} isRunning={false} />
        )}
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
  const [contextFiles, setContextFiles] = useState<{ path: string; name: string; content: string }[]>([]);
  const [detectedPaths, setDetectedPaths] = useState<string[]>([]);
  // Agent / plan mode
  const [agentMode, setAgentMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleStop = () => {
    abortRef.current = true;
    setIsStreaming(false);
    setAgentRunning(false);
  };

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
  const openFile = useEditorStore((s) => s.openFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const setDiff = useEditorStore((s) => s.setDiff);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const addMessage = useEditorStore((s) => s.addMessage);
  const activeSession = useEditorStore((s) => s.activeSession)();
  const isDiffMode = useEditorStore((s) => s.isDiffMode);
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const setWorkspacePath = useEditorStore((s) => s.setWorkspacePath);
  const setTerminalCwd = useEditorStore((s) => s.setTerminalCwd);
  const activeTerminalId = useEditorStore((s) => s.activeTerminalId);
  const addPromptHistory = useEditorStore((s) => s.addPromptHistory);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // Detect file paths in prompt
  const handlePromptChange = useCallback(async (val: string) => {
    setPrompt(val);
    if (!workspacePath) return;
    const paths = detectFilePaths(val);
    const newPaths = paths.filter(
      (p) => !contextFiles.some((cf) => cf.path.endsWith(p)) && !activeFilePath?.endsWith(p)
    );
    setDetectedPaths(newPaths);
  }, [contextFiles, activeFilePath, workspacePath]);

  // Open detected file as the active editor file (so AI edits it directly)
  const switchToDetectedFile = async (relPath: string) => {
    if (!workspacePath) return;
    const fullPath = relPath.startsWith("/") ? relPath : `${workspacePath}/${relPath}`;
    setDetectedPaths((prev) => prev.filter(p => p !== relPath));
    try {
      const existing = openFiles.find((f) => f.path === fullPath);
      if (existing) {
        setActiveFile(fullPath);
        return;
      }
      const content = await invoke<string>("read_file", { path: fullPath });
      const language = await invoke<string>("get_file_language", { path: fullPath });
      const name = relPath.split("/").pop() ?? relPath;
      openFile({ path: fullPath, name, content, language, isDirty: false });
    } catch (e) {
      console.error("Could not open detected file:", e);
    }
  };

  const loadContextFile = async (relPath: string) => {
    if (!workspacePath) return;
    const fullPath = relPath.startsWith("/") ? relPath : `${workspacePath}/${relPath}`;
    try {
      const content = await invoke<string>("read_file", { path: fullPath });
      const name = relPath.split("/").pop() ?? relPath;
      setContextFiles((prev) => [...prev.filter(f => f.path !== fullPath), { path: fullPath, name, content }]);
      setDetectedPaths((prev) => prev.filter(p => p !== relPath));
    } catch {
      setDetectedPaths((prev) => prev.filter(p => p !== relPath));
    }
  };

  const removeContextFile = (path: string) => {
    setContextFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const buildContextBlock = () => {
    if (contextFiles.length === 0) return "";
    const parts = contextFiles.map(f =>
      `--- Context file: ${f.name} ---\n${f.content.slice(0, 8000)}\n--- end ${f.name} ---`
    );
    return "\n\nAdditional context files:\n" + parts.join("\n\n");
  };

  const handleSend = async () => {
    if (!prompt.trim() || !selectedModel || !activeFile || isStreaming) return;

    abortRef.current = false;
    const userPrompt = prompt.trim();
    const beforeContent = activeFile.content;
    setPrompt("");
    setDetectedPaths([]);
    clearStream();
    setIsStreaming(true);
    setDiff([], "");

    addMessage({
      id: `m_${Date.now()}`,
      role: "user",
      content: userPrompt + (contextFiles.length > 0 ? ` [+${contextFiles.length} context file${contextFiles.length !== 1 ? "s" : ""}]` : ""),
      filePath: activeFile.path,
      timestamp: Date.now(),
    });

    const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;
    const contextBlock = buildContextBlock();
    const enrichedPrompt = userPrompt + contextBlock;

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

      // If no hunks and model output is short (explanation, not a full file), show the text
      const isExplanation = hunks.length === 0 && modified.length < activeFile.content.length * 0.5;
      addMessage({
        id: `m_${Date.now()}`,
        role: "assistant",
        content: hunks.length > 0
          ? `Applied ${hunks.length} change${hunks.length !== 1 ? "s" : ""}`
          : isExplanation
            ? modified.trim().slice(0, 500)
            : "No changes detected — the model returned the same content.",
        hunks,
        modifiedContent: hunks.length > 0 ? modified : undefined,
        filePath: activeFile.path,
        timestamp: Date.now(),
      });

      // Save to prompt history
      if (hunks.length > 0) {
        addPromptHistory({
          id: `ph_${Date.now()}`,
          timestamp: Date.now(),
          prompt: userPrompt,
          workspacePath: workspacePath ?? "",
          files: [{
            path: activeFile.path,
            name: activeFile.name,
            beforeContent,
            afterContent: modified,
            hunks,
          }],
        });
      }

      clearStream();
      setIsStreaming(false);
    });

    // Pass last 10 messages as history (exclude the one we just added)
    const historyMessages = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await invoke("stream_llm", {
        provider,
        baseUrl,
        model: selectedModel,
        fileContent: activeFile.content,
        filePath: activeFile.path,
        userPrompt: enrichedPrompt,
        history: historyMessages,
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

  // ── Bootstrap: open newly created project in the IDE ──────────────
  const openCreatedProject = async (projectPath: string) => {
    setWorkspacePath(projectPath);
    setTerminalCwd(activeTerminalId, projectPath);
    try {
      const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: projectPath });
      // Dispatch a custom event so FileTree can pick up the new tree
      window.dispatchEvent(new CustomEvent("locai:open-workspace", { detail: { path: projectPath, entries } }));
    } catch { /* ignore — user can browse manually */ }
  };

  // ── Agent send ──────────────────────────────────────────────────
  const handleAgentSend = async (overridePrompt?: string) => {
    const userPrompt = (overridePrompt ?? prompt).trim();
    if (!userPrompt || !selectedModel || agentRunning) return;

    // ── No workspace? Bootstrap project creation flow ──────────────
    let effectiveWorkspace = workspacePath;
    let isBootstrap = false;

    if (!effectiveWorkspace) {
      // Ask user where to create the project
      const parentDir = await openDialog({ directory: true, multiple: false, title: "Choose parent folder for the new project" });
      if (!parentDir || typeof parentDir !== "string") return; // user cancelled
      effectiveWorkspace = parentDir;
      isBootstrap = true;
    }

    abortRef.current = false;
    setPrompt("");
    setDetectedPaths([]);
    setPendingPlan(null);
    setAgentRunning(true);
    setLiveSteps([]);

    addMessage({
      id: `m_${Date.now()}`,
      role: "user",
      content: userPrompt,
      timestamp: Date.now(),
    });

    if (isBootstrap) {
      addMessage({
        id: `m_${Date.now() + 1}`,
        role: "assistant",
        content: `🚀 Creating project in **${effectiveWorkspace}** …`,
        timestamp: Date.now() + 1,
      });
    }

    const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;

    // ── Plan mode: generate plan first, then let user confirm ──────
    if (planMode) {
      try {
        const planMessages: AgentMessage[] = [
          { role: "system", content: buildPlanSystemPrompt(effectiveWorkspace) },
          { role: "user", content: userPrompt },
        ];
        const result = await invoke<LlmStepResult>("call_llm_step", {
          provider, baseUrl, model: selectedModel, messages: planMessages, tools: [],
        });
        const planText = result.type === "content" ? result.content : "Could not generate a plan.";
        setPendingPlan(planText);
        addMessage({
          id: `m_${Date.now()}`,
          role: "assistant",
          content: `**Plan:**\n${planText}`,
          timestamp: Date.now(),
        });
        setAgentRunning(false);
        return;
      } catch (e) {
        addMessage({ id: `m_${Date.now()}`, role: "assistant", content: `Plan error: ${e}`, timestamp: Date.now() });
        setAgentRunning(false);
        return;
      }
    }

    // ── Agent loop (XML tool protocol — works with all local LLMs) ───
    const systemPrompt = buildAgentSystemPrompt(effectiveWorkspace, isBootstrap);
    const historyMsgs: AgentMessage[] = messages.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let agentMessages: AgentMessage[] = [
      { role: "system", content: systemPrompt },
      ...historyMsgs,
      { role: "user", content: userPrompt },
    ];

    const steps: AgentStep[] = [];
    const MAX_STEPS = 30;

    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        if (abortRef.current) {
          addMessage({ id: `m_${Date.now()}`, role: "assistant", content: `🛑 Interrupted by user.`, agentSteps: [...steps], timestamp: Date.now() });
          setLiveSteps([]);
          setAgentRunning(false);
          break;
        }
        // Send empty tools array — tool protocol is embedded in system prompt
        const result = await invoke<LlmStepResult>("call_llm_step", {
          provider,
          baseUrl,
          model: selectedModel,
          messages: agentMessages,
          tools: [],
        });

        const rawText = result.type === "content" ? (result.content ?? "") : "";
        const toolCalls = parseToolCalls(rawText);

        if (toolCalls.length > 0) {
          // Add assistant turn to conversation
          agentMessages.push({ role: "assistant", content: rawText });

          const toolResultLines: string[] = [];

          for (const tc of toolCalls) {
            const step: AgentStep = {
              id: tc.id,
              tool: tc.name,
              args: tc.args,
              status: "running",
            };
            steps.push(step);
            setLiveSteps([...steps]);

            if (abortRef.current) break;

            // Reuse executeToolCall by building a fake AgentToolCall
            const fakeCall: AgentToolCall = {
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.argsRaw },
            };
            const toolResult = await executeToolCall(fakeCall, effectiveWorkspace!);

            step.result = toolResult;
            step.status = toolResult.startsWith("Error:") ? "error" : "done";
            setLiveSteps([...steps]);

            toolResultLines.push(`[${tc.name}] ${toolResult.slice(0, 2000)}`);
          }

          // Feed all results back as a single user message
          agentMessages.push({
            role: "user",
            content: `Tool results:\n${toolResultLines.join("\n\n")}`,
          });
        } else {
          // No tool calls → agent finished
          const summary = stripToolBlocks(rawText);

          // Parse PROJECT_PATH: from summary (bootstrap mode)
          let projectOpened = false;
          if (isBootstrap) {
            const match = summary.match(/^PROJECT_PATH:\s*(.+)$/m);
            if (match) {
              const newProjectPath = match[1].trim();
              await openCreatedProject(newProjectPath);
              projectOpened = true;
            }
          }

          addMessage({
            id: `m_${Date.now()}`,
            role: "assistant",
            content: (summary || "Done.") + (projectOpened ? "\n\n✅ Project opened in explorer." : ""),
            agentSteps: [...steps],
            timestamp: Date.now(),
          });
          setLiveSteps([]);

          // Reload active file if modified by agent
          if (activeFilePath && !isBootstrap) {
            try {
              const fresh = await invoke<string>("read_file", { path: activeFilePath });
              const af = openFiles.find((f) => f.path === activeFilePath);
              if (af && fresh !== af.content) {
                useEditorStore.getState().updateFileContent(activeFilePath, fresh);
              }
            } catch { /* ignore */ }
          }
          break;
        }
      }
    } catch (e) {
      addMessage({ id: `m_${Date.now()}`, role: "assistant", content: `Agent error: ${e}`, agentSteps: [...steps], timestamp: Date.now() });
      setLiveSteps([]);
    }

    setAgentRunning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (agentMode) {
        handleAgentSend();
      } else {
        handleSend();
      }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [prompt]);

  return (
    <div className="ai-panel">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-title">LOCAI</div>
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

      {/* Mode bar */}
      <div className="ai-mode-bar">
        <button
          className={`ai-mode-btn ${!agentMode ? "active" : ""}`}
          onClick={() => { setAgentMode(false); setPlanMode(false); }}
          title="Edit mode — AI edits the active file with diff preview"
        >
          edit
        </button>
        <button
          className={`ai-mode-btn ${agentMode && !planMode ? "active" : ""}`}
          onClick={() => { setAgentMode(true); setPlanMode(false); }}
          title="Agent mode — AI uses tools to read/write/delete files, run commands"
        >
          agent
        </button>
        <button
          className={`ai-mode-btn ${agentMode && planMode ? "active" : ""}`}
          onClick={() => { setAgentMode(true); setPlanMode(true); }}
          title="Plan mode — AI creates a step-by-step plan before executing"
        >
          plan
        </button>
      </div>

      {/* Messages */}
      <div className="ai-messages">
        {messages.length === 0 && !isStreaming && !agentRunning && !streamBuffer && (
          <div className="ai-empty">
            <div className="ai-empty-text">
              {activeFile
                ? `editing ${activeFile.name}`
                : agentMode && !workspacePath
                  ? "describe the project to create — agent will build & open it"
                  : agentMode
                    ? "describe what to do across the project"
                    : "open a file to start"}
            </div>
            {agentMode && !workspacePath && (
              <div className="ai-empty-hint">
                💡 No workspace open — type what you want to build and press ↑<br />
                Agent will ask you where to save the project.
              </div>
            )}
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
            agentSteps={m.agentSteps}
          />
        ))}
        {/* Live agent steps while running */}
        {agentRunning && (
          <div className="msg msg-assistant animate-fade-in">
            <div className="msg-role">agent</div>
            <div className="msg-body">
              <AgentStepList steps={liveSteps} isRunning={agentRunning} />
            </div>
          </div>
        )}
        {/* Streaming indicator (edit mode) */}
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
        {/* Pending plan — show Execute button */}
        {pendingPlan && (
          <div className="ai-plan-confirm animate-slide-up">
            <div className="ai-plan-confirm-label">Execute this plan?</div>
            <div className="ai-plan-confirm-actions">
              <button
                className="ai-plan-execute"
                onClick={() => {
                  const p = pendingPlan;
                  setPendingPlan(null);
                  setPlanMode(false); // run without re-planning
                  handleAgentSend(`Execute this plan:\n${p}`);
                }}
              >
                ▶ Execute
              </button>
              <button className="ai-plan-discard" onClick={() => setPendingPlan(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Diff status (edit mode only) */}
      {isDiffMode && !isStreaming && !agentMode && (
        <div className="ai-diff-status animate-slide-up">
          <span className="ai-diff-pulse" />
          <span>{useEditorStore.getState().diffHunks.length} changes waiting</span>
          <span className="ai-diff-hint">Accept or reject in editor</span>
        </div>
      )}

      {/* Context badge */}
      {(activeFile || agentMode) && (
        <div className="ai-ctx">
          {activeFile ? (
            <>
              <span className="ai-ctx-name">{activeFile.name}</span>
              <span className="ai-ctx-sep">·</span>
              <span className="ai-ctx-lines">{activeFile.content.split("\n").length} lines</span>
            </>
          ) : (
            <span className="ai-ctx-name" style={{ color: "var(--accent)" }}>workspace</span>
          )}
        </div>
      )}

      {/* Detected file paths → offer to open as active or add as context */}
      {detectedPaths.length > 0 && (
        <div className="ai-detected-files animate-slide-up">
          <span className="ai-detected-label">Referenced:</span>
          {detectedPaths.map((p) => (
            <div key={p} className="ai-detected-file-row">
              <span className="ai-detected-filename">{p.split("/").pop()}</span>
              <button
                className="ai-detected-btn ai-detected-btn-switch"
                onClick={() => switchToDetectedFile(p)}
                title={`Open ${p} as active file (AI will edit this)`}
              >
                open &amp; fix
              </button>
              <button
                className="ai-detected-btn"
                onClick={() => loadContextFile(p)}
                title="Add as context only"
              >
                context
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Context files */}
      {contextFiles.length > 0 && (
        <div className="ai-ctx-files">
          {contextFiles.map((f) => (
            <div key={f.path} className="ai-ctx-file">
              <span className="ai-ctx-file-name">{f.name}</span>
              <button className="ai-ctx-file-remove" onClick={() => removeContextFile(f.path)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Prompt */}
      <div className="ai-input-area">
        <textarea
          ref={textareaRef}
          className="ai-textarea"
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            agentMode && !workspacePath
              ? "describe the project to create (e.g. React calculator app)…"
              : agentMode
                ? "describe what to do… agent will read/write/run across the project"
                : activeFile
                  ? "describe changes… mention file paths to include as context"
                  : "open a file first"
          }
          disabled={agentMode ? agentRunning : (!activeFile || isStreaming)}
          rows={1}
        />
        {isStreaming || agentRunning ? (
          <button
            className="ai-send"
            onClick={handleStop}
            title="Stop Generation"
            style={{ color: "var(--red)" }}
          >
            🛑
          </button>
        ) : (
          <button
            className="ai-send"
            onClick={agentMode ? () => handleAgentSend() : handleSend}
            disabled={
              agentMode
                ? !selectedModel || !prompt.trim()
                : !activeFile || !selectedModel || !prompt.trim()
            }
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
