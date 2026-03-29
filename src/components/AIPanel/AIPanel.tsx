
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AgentStepList } from "./AgentSteps";
import { MessageBubble } from "./MessageBubble";
import { SessionList } from "./SessionList";
import { useEditorStore } from "../../store/editorStore";
import { AgentMessage, AgentStep, DiffHunk, LlmStepResult } from "../../types";
import { detectFilePaths, findNodeInTree } from "../../lib/file-utils";
import { buildAgentSystemPrompt, buildPlanSystemPrompt } from "../../lib/llm/prompts";
import { runAgentLoop } from "../../lib/llm/agent-loop";
import { cleanThinkFromCode } from "../../lib/llm/utils";
import {
  History,
  Settings,
  PanelRight,
  StopCircle,
  SendHorizontal,
  ClipboardList,
  Check,
  Plus
} from "lucide-react";
import "./AIPanel.css";

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
  const [pausedStream, setPausedStream] = useState<string | null>(null);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleStop = () => {
    abortRef.current = true;
    invoke("abort_llm").catch(() => { });
    setAgentRunning(false);
  };

  const provider = useEditorStore((s) => s.provider);
  const selectedModel = useEditorStore((s) => s.selectedModel);
  const settings = useEditorStore((s) => s.settings);
  const isStreaming = useEditorStore((s) => s.isStreaming);
  const setIsStreaming = useEditorStore((s) => s.setIsStreaming);
  const setIsAiBusy = useEditorStore((s) => s.setIsAiBusy);
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
  const createSession = useEditorStore((s) => s.createSession);
  const openCode = useEditorStore((s) => s.openCode);
  const projectTabs = useEditorStore((s) => s.projectTabs);
  const activeProjectTabId = useEditorStore((s) => s.activeProjectTabId);
  const aiPanelMode = useEditorStore((s) => s.aiPanelMode);
  const setAiPanelMode = useEditorStore((s) => s.setAiPanelMode);
  const fileTree = projectTabs.find(t => t.id === activeProjectTabId)?.fileTree ?? [];

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    // Auto-plan fallback for long thoughts
    if (isStreaming && streamBuffer.includes("<think>") && !streamBuffer.includes("</think>") && streamBuffer.length > 1500) {
      if (!planMode) setPlanMode(true);
    }
  }, [messages, streamBuffer, isStreaming, planMode]);

  useEffect(() => {
    setIsAiBusy(isStreaming || agentRunning);
    return () => setIsAiBusy(false);
  }, [isStreaming, agentRunning, setIsAiBusy]);

  // Detect file paths in prompt
  const handlePromptChange = useCallback(async (val: string) => {
    setPrompt(val);
    if (!workspacePath) return;
    const paths = detectFilePaths(val);
    const newPaths = paths.filter(
      (p) => !contextFiles.some((cf) => cf.path.includes(p)) && (!activeFilePath || !activeFilePath.includes(p))
    );
    setDetectedPaths(newPaths);
  }, [contextFiles, activeFilePath, workspacePath]);

  // Open detected file as the active editor file (so AI edits it directly)
  const switchToDetectedFile = async (query: string) => {
    if (!workspacePath) return;
    const resolvedPath = findNodeInTree(fileTree, query) || (query.startsWith("/") ? query : `${workspacePath}/${query}`);
    setDetectedPaths((prev) => prev.filter(p => p !== query));
    try {
      const existing = openFiles.find((f) => f.path === resolvedPath);
      if (existing) {
        setActiveFile(resolvedPath);
        return;
      }
      const content = await invoke<string>("read_file", { path: resolvedPath });
      const language = await invoke<string>("get_file_language", { path: resolvedPath });
      const name = resolvedPath.split("/").pop() ?? resolvedPath;
      openFile({ path: resolvedPath, name, content, language, isDirty: false });
    } catch (e) {
      console.error("Could not open detected file:", e);
    }
  };

  const loadContextFile = async (query: string) => {
    if (!workspacePath) return;
    const resolvedPath = findNodeInTree(fileTree, query) || (query.startsWith("/") ? query : `${workspacePath}/${query}`);
    try {
      const content = await invoke<string>("read_file", { path: resolvedPath });
      const name = resolvedPath.split("/").pop() ?? resolvedPath;
      setContextFiles((prev) => [...prev.filter(f => f.path !== resolvedPath), { path: resolvedPath, name, content }]);
      setDetectedPaths((prev) => prev.filter(p => p !== query));
    } catch {
      setDetectedPaths((prev) => prev.filter(p => p !== query));
    }
  };

  const removeContextFile = (path: string) => {
    setContextFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const buildContextBlock = () => {
    if (contextFiles.length === 0) return "";
    const parts = contextFiles.map(f =>
      `--- Context file: ${f.name} ---\n${f.content.slice(0, 3000)}\n--- end ${f.name} ---`
    );
    return "\n\nAdditional context files:\n" + parts.join("\n\n");
  };

  const handleSend = async (resumeFromPartial?: string) => {
    if ((!prompt.trim() && !resumeFromPartial) || !selectedModel || !activeFile || isStreaming) return;

    abortRef.current = false;
    const userPrompt = prompt.trim() || (resumeFromPartial ? "Continue exactly where you left off. Do not repeat the output you already provided." : "");
    const beforeContent = activeFile.content;

    if (!resumeFromPartial) {
      setPrompt("");
      setDetectedPaths([]);
      clearStream();
      setDiff([], "");
      addMessage({
        id: `m_${Date.now()}`,
        role: "user",
        content: userPrompt + (contextFiles.length > 0 ? ` [+${contextFiles.length} context file${contextFiles.length !== 1 ? "s" : ""}]` : ""),
        filePath: activeFile.path,
        timestamp: Date.now(),
      });
    } else {
      setPausedStream(null);
    }

    setIsStreaming(true);

    const baseUrl = provider === "ollama" ? settings.ollamaUrl : settings.lmstudioUrl;
    const contextBlock = buildContextBlock();
    const enrichedPrompt = resumeFromPartial ? userPrompt : (userPrompt + contextBlock);

    const unlistenChunk = await listen<string>("llm-chunk", (ev) => appendStream(ev.payload));

    let unlistenDoneFn: () => void = () => { };
    let unlistenAbortedFn: () => void = () => { };

    const cleanupListeners = () => {
      unlistenChunk();
      unlistenDoneFn();
      unlistenAbortedFn();
    };

    const unlistenDone = await listen<string>("llm-done", async (ev) => {
      const modified = cleanThinkFromCode(ev.payload);
      cleanupListeners();

      let hunks: DiffHunk[] = [];
      try {
        if (modified !== activeFile.content) {
          hunks = await invoke<DiffHunk[]>("compute_diff", {
            original: activeFile.content,
            modified,
          });
        }
        setDiff(hunks, modified);
      } catch (e) {
        console.error("Diff failed:", e);
      }

      addMessage({
        id: `m_${Date.now()}`,
        role: "assistant",
        content: hunks.length > 0
          ? `Applied ${hunks.length} change${hunks.length !== 1 ? "s" : ""}`
          : "No changes detected. Model output was ignored because it was not a valid file edit.",
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
    unlistenDoneFn = unlistenDone;

    const unlistenAborted = await listen<string>("llm-aborted", async (ev) => {
      cleanupListeners();
      setPausedStream(ev.payload);
      setIsStreaming(false);
    });
    unlistenAbortedFn = unlistenAborted;

    // Keep history compact to reduce token/prompt latency
    const historyMessages = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1200),
    }));

    const modelSettings = settings.modelSettings[selectedModel] || { reasoningEnabled: false, customInstructions: "" };

    try {
      await invoke("stream_llm", {
        provider,
        baseUrl,
        model: selectedModel,
        fileContent: activeFile.content,
        filePath: activeFile.path,
        userPrompt: enrichedPrompt,
        history: historyMessages,
        partialAssistant: resumeFromPartial || null,
        customInstructions: modelSettings.customInstructions,
        reasoningEnabled: modelSettings.reasoningEnabled,
      });
    } catch (e: any) {
      cleanupListeners();
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
      const entries = await invoke<any[]>("read_dir_recursive", { path: projectPath });
      window.dispatchEvent(new CustomEvent("locai:open-workspace", { detail: { path: projectPath, entries } }));
    } catch { /* ignore */ }
  };

  // ── Agent send ──────────────────────────────────────────────────
  const handleAgentSend = async (overridePrompt?: string) => {
    const userPrompt = (overridePrompt ?? prompt).trim();
    if (!userPrompt || !selectedModel || agentRunning) return;

    let effectiveWorkspace = workspacePath;
    let isBootstrap = false;

    if (!effectiveWorkspace) {
      const parentDir = await openDialog({ directory: true, multiple: false, title: "Choose parent folder for the new project" });
      if (!parentDir || typeof parentDir !== "string") return;
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

    if (planMode) {
      try {
        const modelSettings = settings.modelSettings[selectedModel] || { reasoningEnabled: false, customInstructions: "" };
        const planMessages: AgentMessage[] = [
          { role: "system", content: buildPlanSystemPrompt(effectiveWorkspace, modelSettings.customInstructions) },
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

    // Agent Loop using lib logic
    try {
      const modelSettings = settings.modelSettings[selectedModel] || { reasoningEnabled: false, customInstructions: "" };
      const systemPrompt = buildAgentSystemPrompt(
        effectiveWorkspace, 
        openCode, 
        isBootstrap, 
        modelSettings.customInstructions, 
        modelSettings.reasoningEnabled
      );
      const historyMsgs: AgentMessage[] = messages.slice(-8).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      await runAgentLoop(
        userPrompt,
        effectiveWorkspace,
        systemPrompt,
        historyMsgs,
        { provider, model: selectedModel, baseUrl },
        {
          onStepProgress: (steps) => setLiveSteps(steps),
          onNewMessage: async (res) => {
            let summary = res.content;
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
              role: res.role as "user" | "assistant",
              content: summary + (projectOpened ? "\n\n✅ Project opened in explorer." : ""),
              agentSteps: res.agentSteps,
              timestamp: Date.now(),
            });

            // Reload file if modified
            if (activeFilePath && !isBootstrap) {
              try {
                const fresh = await invoke<string>("read_file", { path: activeFilePath });
                const af = openFiles.find((f) => f.path === activeFilePath);
                if (af && fresh !== af.content) {
                  useEditorStore.getState().updateFileContent(activeFilePath, fresh);
                }
              } catch { }
            }
          },
          shouldAbort: () => abortRef.current,
        }
      );
    } catch (e) {
      addMessage({ id: `m_${Date.now()}`, role: "assistant", content: `Agent error: ${e}`, agentSteps: [...liveSteps], timestamp: Date.now() });
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

  const pendingAITask = useEditorStore((s) => s.pendingAITask);
  const clearAITask = useEditorStore((s) => s.clearAITask);

  useEffect(() => {
    if (pendingAITask && !agentRunning && !isStreaming) {
      const taskPrompt = pendingAITask.prompt;
      const nextMode = pendingAITask.mode ?? "editor";
      setAgentMode(nextMode === "agent");

      setTimeout(() => {
        setPrompt(taskPrompt);
        clearAITask();
        if (pendingAITask.autoSend && nextMode === "agent") {
          handleAgentSend(taskPrompt);
        }
      }, 80);
    }
  }, [pendingAITask, agentRunning, isStreaming, clearAITask]);


  return (
    <div className={`ai-panel ai-panel-${aiPanelMode}`}>
      {showSess && <SessionList onClose={() => setShowSess(false)} />}

      <div className="ai-header">
        <div className="ai-header-left">
          <div className="ai-header-badges">
            <button
              className={`ai-badge ${agentMode ? "" : "active"}`}
              onClick={() => setAgentMode(false)}
            >
              Editor
            </button>
            <button
              className={`ai-badge ${agentMode ? "active" : ""}`}
              onClick={() => setAgentMode(true)}
            >
              Agent
            </button>
          </div>
        </div>
        <div className="flex flex-row">
          <button className="ai-icon-btn" title="New Session" onClick={createSession}>
            <Plus size={16} />
          </button>
          <button className="ai-icon-btn" title="Sessions" onClick={() => setShowSess(true)}>
            <History size={16} />
          </button>
          <button className="ai-icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
          </button>
          <button
            className="ai-icon-btn"
            onClick={() => setAiPanelMode(aiPanelMode === "pinned" ? "floating" : "pinned")}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </div>
      <div className="ai-messages">
        {!messages.length && !isStreaming && !agentRunning && (
          <div className="ai-empty">
            <div className="ai-empty-title">
              Assistant
            </div>
            <div className="ai-empty-hint">
              {activeFile
                ? `Ready to assist with ${activeFile.name}. Describe the requested modifications or questions.`
                : agentMode && !workspacePath
                  ? "Describe the initial structure of the new project to begin scaffolding."
                  : agentMode
                    ? "Input project-wide instructions for the autonomous agent loop."
                    : "Select a source file to start an interactive contextual session."}
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
        {/* Paused stream */}
        {pausedStream && !isStreaming && (
          <div className="msg msg-assistant animate-fade-in">
            <div className="msg-role">ai (paused)</div>
            <div className="msg-body">
              <div className="msg-text">
                <span className="msg-think-content" style={{ color: "var(--text-muted)" }}>
                  {pausedStream.length > 200 ? "..." + pausedStream.slice(-200) : pausedStream}
                </span>
              </div>
              <button
                className="ai-detected-btn ai-detected-btn-switch"
                onClick={() => handleSend(pausedStream)}
                style={{ marginTop: 8 }}
              >
                ▶ Resume Generation
              </button>
            </div>
          </div>
        )}
        {/* Pending plan */}
        {pendingPlan && (
          <div className="ai-plan-confirm animate-slide-up">
            <div className="ai-plan-confirm-label">Execute this plan?</div>
            <div className="ai-plan-confirm-actions">
              <button
                className="ai-plan-execute"
                onClick={() => {
                  const p = pendingPlan;
                  setPendingPlan(null);
                  setPlanMode(false);
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

      {isDiffMode && !isStreaming && !agentMode && (
        <div className="ai-diff-status">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Check size={14} />
            <span style={{ fontWeight: 600 }}>{useEditorStore.getState().diffHunks.length} CHANGES PENDING</span>
          </div>
          <span className="ai-diff-hint">REVIEW IN EDITOR</span>
        </div>
      )}

      <div className="ai-input-area">
        {detectedPaths.length > 0 && (
          <div className="ai-detected animate-slide-up">
            <div className="ai-detected-label">Detected files:</div>
            {detectedPaths.map(p => (
              <div key={p} className="ai-detected-row">
                <span className="ai-detected-path">{p}</span>
                <div className="ai-detected-actions">
                  <button className="ai-detected-btn ai-detected-btn-switch" onClick={() => switchToDetectedFile(p)}>Open</button>
                  <button className="ai-detected-btn ai-detected-btn-context" onClick={() => loadContextFile(p)}>Add Context</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {contextFiles.length > 0 && (
          <div className="ai-context animate-slide-up">
            {contextFiles.map(f => (
              <div key={f.path} className="ai-context-pill">
                <span>{f.name}</span>
                <button onClick={() => removeContextFile(f.path)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-input-wrapper">
          <textarea
            ref={textareaRef}
            className="ai-textarea"
            placeholder={agentMode ? "What project-wide task should I do?" : (activeFile ? `Ask about ${activeFile.name}...` : "Select a file to edit...")}
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || agentRunning}
          />
          <div className="ai-controls">
            <div className="ai-controls-left">
              <button
                className={`ai-mode-toggle flex flex-row items-center ${planMode ? "active" : ""}`}
                onClick={() => setPlanMode(!planMode)}
                title="Planning Mode - Generates a plan before execution"
              >
                <ClipboardList size={12} style={{ marginRight: 6 }} />
                Plan Mode
              </button>
            </div>
            <div className="ai-controls-right">
              {(isStreaming || agentRunning) ? (
                <button className="ai-stop-btn flex flex-row items-center text-xs px-2 py-1" onClick={handleStop}>
                  <StopCircle size={14} style={{ marginRight: 6 }} />
                  Stop
                </button>
              ) : (
                <button
                  className="ai-send-btn"
                  onClick={() => agentMode ? handleAgentSend() : handleSend()}
                  disabled={!prompt.trim() || !selectedModel || (!activeFile && !agentMode)}
                >
                  <SendHorizontal size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
