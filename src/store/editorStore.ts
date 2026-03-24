import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DiffHunk, Session, ChatMessage, Theme, TerminalSession, TerminalLine, PromptHistoryEntry, FileEntry } from "../types";

let _lineId = 0;
export function nextLineId() { return ++_lineId; }

function makeTermSession(cwd: string, num: number): TerminalSession {
  return { id: `t_${Date.now()}_${num}`, name: `bash ${num}`, lines: [], cwd, running: false, history: [], historyIdx: -1 };
}

const HISTORY_KEY = "locai_prompt_history";
function loadHistory(): PromptHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveHistory(h: PromptHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 200)));
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
}

export type LLMProvider = "ollama" | "lmstudio";

export interface Settings {
  ollamaUrl: string;
  lmstudioUrl: string;
  fontFamily: string;
  fontSize: number;
}

export type ProjectType = "frontend" | "backend" | "unknown";

export interface ProjectInfo {
  type: ProjectType;
  framework?: "react" | "next" | "express" | "vite" | "vue";
  port?: number;
}

// ── Project Tab ─────────────────────────────────────────────────
export interface ProjectTab {
  id: string;
  name: string;        // display name, usually folder name
  workspacePath: string | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  fileTree: FileEntry[];
  terminalCwd: string;
  projectInfo: ProjectInfo;
}

function newProjectTab(num: number): ProjectTab {
  return {
    id: `pt_${Date.now()}_${num}`,
    name: `Project ${num}`,
    workspacePath: null,
    openFiles: [],
    activeFilePath: null,
    fileTree: [],
    terminalCwd: "/",
    projectInfo: { type: "unknown" },
  };
}

// ── Session helpers ───────────────────────────────────────────────
const SESSIONS_KEY = "locai_sessions";
const ACTIVE_SESSION_KEY = "locai_active_session";

function loadSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]");
  } catch { return []; }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function newSession(workspacePath?: string | null): Session {
  const now = Date.now();
  return {
    id: `s_${now}`,
    name: `Session ${new Date(now).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    workspacePath,
  };
}

function getOrCreateActiveSession(sessions: Session[]): { sessions: Session[]; activeId: string } {
  const storedId = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (storedId && sessions.find(s => s.id === storedId)) {
    return { sessions, activeId: storedId };
  }
  if (sessions.length > 0) {
    return { sessions, activeId: sessions[sessions.length - 1].id };
  }
  const s = newSession();
  return { sessions: [s], activeId: s.id };
}

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export interface MCPServer {
  id: string;
  name: string;
  url: string;
}

// ── Store ─────────────────────────────────────────────────────────
interface EditorState {
  // ── Project Tabs ─────────────────────────────────────────────────
  projectTabs: ProjectTab[];
  activeProjectTabId: string;
  createProjectTab: () => void;
  closeProjectTab: (id: string) => void;
  switchProjectTab: (id: string) => void;
  renameProjectTab: (id: string, name: string) => void;
  // Update current tab's file tree after folder open / project create
  setTabFileTree: (tree: FileEntry[]) => void;

  // Workspace (mirrors active tab)
  workspacePath: string | null;
  setWorkspacePath: (path: string | null) => void;

  // Open files (mirrors active tab)
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (file: Omit<OpenFile, "originalContent">) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;

  // File tree (mirrors active tab)
  fileTree: FileEntry[];
  
  // Project info for active tab
  projectInfo: ProjectInfo;
  setProjectInfo: (info: ProjectInfo) => void;

  // Diff state
  diffHunks: DiffHunk[];
  modifiedContent: string;
  isDiffMode: boolean;
  setDiff: (hunks: DiffHunk[], modified: string) => void;
  acceptHunk: (id: number) => void;
  rejectHunk: (id: number) => void;
  acceptAll: () => void;
  rejectAll: () => void;

  // LLM
  provider: LLMProvider;
  setProvider: (p: LLMProvider) => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  streamBuffer: string;
  appendStream: (chunk: string) => void;
  clearStream: () => void;

  // Global AI Task Dispatcher
  pendingAITask: string | null;
  dispatchAITask: (prompt: string) => void;
  clearAITask: () => void;

  // Sessions
  sessions: Session[];
  activeSessionId: string;
  showSessions: boolean;
  setShowSessions: (v: boolean) => void;
  createSession: () => void;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  addMessage: (msg: ChatMessage) => void;
  activeSession: () => Session | undefined;

  // Settings
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;

  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;

  // Terminal (multi-session)
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean) => void;
  terminalSessions: TerminalSession[];
  activeTerminalId: string;
  createTerminalSession: () => void;
  closeTerminalSession: (id: string) => void;
  switchTerminalSession: (id: string) => void;
  appendTerminalLine: (sessionId: string, line: TerminalLine) => void;
  setTerminalRunning: (sessionId: string, running: boolean) => void;
  setTerminalCwd: (sessionId: string, cwd: string) => void;
  pushTerminalHistory: (sessionId: string, cmd: string) => void;
  setTerminalHistoryIdx: (sessionId: string, idx: number) => void;
  clearTerminalLines: (sessionId: string) => void;
  executeTerminalCommand: (cmd: string) => void;
  // legacy compat
  terminalCwd: string | null;

  // Activity bar / sidebar view
  sidebarView: "files" | "git" | "search" | "history" | "skills" | "mcp";
  setSidebarView: (v: "files" | "git" | "search" | "history" | "skills" | "mcp") => void;
  sidebarVisible: boolean;
  setSidebarVisible: (v: boolean) => void;

  aiPanelMode: "pinned" | "floating";
  setAiPanelMode: (m: "pinned" | "floating") => void;

  // Prompt history
  promptHistory: PromptHistoryEntry[];
  addPromptHistory: (entry: PromptHistoryEntry) => void;

  // Skills
  skills: Skill[];
  addSkill: (skill: Skill) => void;
  removeSkill: (id: string) => void;

  // MCP Servers
  mcpServers: MCPServer[];
  addMCPServer: (server: MCPServer) => void;
  removeMCPServer: (id: string) => void;
}

const _initialTab = newProjectTab(1);
const { sessions: initialSessions, activeId } = getOrCreateActiveSession(loadSessions());
saveSessions(initialSessions);

const _initialTermSession = makeTermSession("/", 1);

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  // ── Project Tabs ───────────────────────────────────────────────
  projectTabs: [_initialTab],
  activeProjectTabId: _initialTab.id,

  createProjectTab: () => {
    const { projectTabs } = get();
    const tab = newProjectTab(projectTabs.length + 1);
    set({
      projectTabs: [...projectTabs, tab],
      activeProjectTabId: tab.id,
      // Switch workspace state to new empty tab
      workspacePath: null,
      openFiles: [],
      activeFilePath: null,
      fileTree: [],
      projectInfo: { type: "unknown" },
    });
  },

  closeProjectTab: (id) => {
    const { projectTabs, activeProjectTabId } = get();
    if (projectTabs.length === 1) return; // keep at least one
    const remaining = projectTabs.filter(t => t.id !== id);
    const nextTab = activeProjectTabId === id
      ? remaining[remaining.length - 1]
      : projectTabs.find(t => t.id === activeProjectTabId)!;
    set({
      projectTabs: remaining,
      activeProjectTabId: nextTab.id,
      workspacePath: nextTab.workspacePath,
      openFiles: nextTab.openFiles,
      activeFilePath: nextTab.activeFilePath,
      fileTree: nextTab.fileTree,
      projectInfo: nextTab.projectInfo,
    });
  },

  switchProjectTab: (id) => {
    const { projectTabs, activeProjectTabId } = get();
    if (id === activeProjectTabId) return;
    // Save current state into current tab snapshot
    const current = get();
    const savedTabs = projectTabs.map(t =>
      t.id === activeProjectTabId
        ? { ...t, workspacePath: current.workspacePath, openFiles: current.openFiles, activeFilePath: current.activeFilePath, fileTree: current.fileTree, projectInfo: current.projectInfo }
        : t
    );
    const target = savedTabs.find(t => t.id === id)!;
    set({
      projectTabs: savedTabs,
      activeProjectTabId: id,
      workspacePath: target.workspacePath,
      openFiles: target.openFiles,
      activeFilePath: target.activeFilePath,
      fileTree: target.fileTree,
      projectInfo: target.projectInfo,
    });
  },

  renameProjectTab: (id, name) => {
    set(s => ({ projectTabs: s.projectTabs.map(t => t.id === id ? { ...t, name } : t) }));
  },

  setTabFileTree: (tree) => {
    const { activeProjectTabId, projectTabs } = get();
    set({
      fileTree: tree,
      projectTabs: projectTabs.map(t =>
        t.id === activeProjectTabId ? { ...t, fileTree: tree } : t
      ),
    });
  },

  workspacePath: null,
  setWorkspacePath: (path) => set((s) => ({
    workspacePath: path,
    projectTabs: s.projectTabs.map(t =>
      t.id === s.activeProjectTabId ? { ...t, workspacePath: path, name: path ? path.split("/").pop() ?? path : "Project" } : t
    ),
  })),

  projectInfo: { type: "unknown" },
  setProjectInfo: (info) => set((s) => ({
    projectInfo: info,
    projectTabs: s.projectTabs.map(t =>
      t.id === s.activeProjectTabId ? { ...t, projectInfo: info } : t
    ),
  })),

  openFiles: [],
  activeFilePath: null,
  fileTree: [],

  openFile: (file) =>
    set((s) => {
      const exists = s.openFiles.find((f) => f.path === file.path);
      if (exists) return { activeFilePath: file.path };
      return {
        openFiles: [...s.openFiles, { ...file, originalContent: file.content }],
        activeFilePath: file.path,
      };
    }),

  closeFile: (path) =>
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== path);
      const newActive =
        s.activeFilePath === path
          ? remaining[remaining.length - 1]?.path ?? null
          : s.activeFilePath;
      return { openFiles: remaining, activeFilePath: newActive };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    })),

  markFileSaved: (path) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, isDirty: false } : f
      ),
    })),

  // Diff
  diffHunks: [],
  modifiedContent: "",
  isDiffMode: false,

  setDiff: (hunks, modified) =>
    set({ diffHunks: hunks, modifiedContent: modified, isDiffMode: hunks.length > 0 }),

  acceptHunk: (id) => {
    const { diffHunks, activeFilePath, openFiles } = get();
    const hunk = diffHunks.find((h) => h.id === id);
    if (!hunk || !activeFilePath) return;
    const file = openFiles.find((f) => f.path === activeFilePath);
    if (!file) return;

    const lines = file.content.split("\n");
    const newLines = [
      ...lines.slice(0, hunk.oldStart - 1),
      ...hunk.newLines,
      ...lines.slice(hunk.oldStart - 1 + hunk.oldCount),
    ];
    const newContent = newLines.join("\n");
    const lineDelta = hunk.newLines.length - hunk.oldLines.length;
    const remaining = diffHunks
      .filter((h) => h.id !== id)
      .map((h) =>
        h.oldStart > hunk.oldStart
          ? { ...h, oldStart: h.oldStart + lineDelta, newStart: h.newStart + lineDelta }
          : h
      );

    set((s) => ({
      diffHunks: remaining,
      isDiffMode: remaining.length > 0,
      openFiles: s.openFiles.map((f) =>
        f.path === activeFilePath ? { ...f, content: newContent, isDirty: true } : f
      ),
    }));
  },

  rejectHunk: (id) => {
    const { diffHunks } = get();
    const remaining = diffHunks.filter((h) => h.id !== id);
    set({ diffHunks: remaining, isDiffMode: remaining.length > 0 });
  },

  acceptAll: () => {
    const { modifiedContent, activeFilePath } = get();
    set((s) => ({
      diffHunks: [],
      isDiffMode: false,
      modifiedContent: "",
      openFiles: s.openFiles.map((f) =>
        f.path === activeFilePath
          ? { ...f, content: modifiedContent, originalContent: modifiedContent, isDirty: true }
          : f
      ),
    }));
  },

  rejectAll: () => {
    const { activeFilePath } = get();
    set((s) => ({
      diffHunks: [],
      isDiffMode: false,
      modifiedContent: "",
      openFiles: s.openFiles.map((f) =>
        f.path === activeFilePath
          ? { ...f, content: f.originalContent, isDirty: false }
          : f
      ),
    }));
  },

  // LLM
  provider: "ollama",
  setProvider: (provider) => set({ provider }),
  selectedModel: "",
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  streamBuffer: "",
  appendStream: (chunk) => set((s) => ({ streamBuffer: s.streamBuffer + chunk })),
  clearStream: () => set({ streamBuffer: "" }),

  // Global AI Task Dispatcher
  pendingAITask: null,
  dispatchAITask: (prompt) => {
    set({ pendingAITask: prompt, aiPanelMode: "pinned" }); // ensure panel is visible
  },
  clearAITask: () => set({ pendingAITask: null }),

  // Sessions
  sessions: initialSessions,
  activeSessionId: activeId,
  showSessions: false,
  setShowSessions: (showSessions) => set({ showSessions }),

  createSession: () => {
    const s = newSession(get().workspacePath);
    const sessions = [...get().sessions, s];
    saveSessions(sessions);
    localStorage.setItem(ACTIVE_SESSION_KEY, s.id);
    set({ sessions, activeSessionId: s.id, showSessions: false });
  },

  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    if (sessions.length === 0) {
      const s = newSession(get().workspacePath);
      sessions.push(s);
    }
    const activeSessionId = get().activeSessionId === id
      ? sessions[sessions.length - 1].id
      : get().activeSessionId;
    saveSessions(sessions);
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    set({ sessions, activeSessionId });
  },

  switchSession: (id) => {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
    set({ activeSessionId: id, showSessions: false, streamBuffer: "" });
  },

  renameSession: (id, name) => {
    const sessions = get().sessions.map((s) => s.id === id ? { ...s, name } : s);
    saveSessions(sessions);
    set({ sessions });
  },

  addMessage: (msg) => {
    const { sessions, activeSessionId } = get();
    const updated = sessions.map((s) =>
      s.id === activeSessionId
        ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() }
        : s
    );
    saveSessions(updated);
    set({ sessions: updated });
  },

  activeSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId);
  },

  // Settings
  settings: {
    ollamaUrl: "http://localhost:11434",
    lmstudioUrl: "http://localhost:1234",
    fontFamily: "Outfit",
    fontSize: 14,
  },
  updateSettings: (s) => set((state) => ({ settings: { ...state.settings, ...s } })),
  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),

  // Theme
  theme: (localStorage.getItem("locai_theme") as Theme) ?? "dark",
  setTheme: (theme) => {
    localStorage.setItem("locai_theme", theme);
    document.body.setAttribute("data-theme", theme);
    set({ theme });
  },

  // Terminal (multi-session)
  terminalOpen: false,
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  terminalSessions: [_initialTermSession],
  activeTerminalId: _initialTermSession.id,
  get terminalCwd() {
    const { terminalSessions, activeTerminalId } = get();
    return terminalSessions.find(s => s.id === activeTerminalId)?.cwd ?? null;
  },

  createTerminalSession: () => {
    const { terminalSessions } = get();
    const cwd = terminalSessions[terminalSessions.length - 1]?.cwd ?? "/";
    const num = terminalSessions.length + 1;
    const s = makeTermSession(cwd, num);
    set({ terminalSessions: [...terminalSessions, s], activeTerminalId: s.id });
  },

  closeTerminalSession: (id) => {
    const { terminalSessions, activeTerminalId } = get();
    if (terminalSessions.length === 1) return; // keep at least one
    const remaining = terminalSessions.filter(s => s.id !== id);
    const newActive = activeTerminalId === id
      ? remaining[remaining.length - 1].id
      : activeTerminalId;
    set({ terminalSessions: remaining, activeTerminalId: newActive });
  },

  switchTerminalSession: (id) => set({ activeTerminalId: id }),

  appendTerminalLine: (sessionId, line) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId ? { ...ts, lines: [...ts.lines, line] } : ts
      ),
    })),

  setTerminalRunning: (sessionId, running) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId ? { ...ts, running } : ts
      ),
    })),

  setTerminalCwd: (sessionId, cwd) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId ? { ...ts, cwd } : ts
      ),
    })),

  pushTerminalHistory: (sessionId, cmd) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId
          ? { ...ts, history: [cmd, ...ts.history.slice(0, 99)], historyIdx: -1 }
          : ts
      ),
    })),

  setTerminalHistoryIdx: (sessionId, idx) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId ? { ...ts, historyIdx: idx } : ts
      ),
    })),

  clearTerminalLines: (sessionId) =>
    set(s => ({
      terminalSessions: s.terminalSessions.map(ts =>
        ts.id === sessionId ? { ...ts, lines: [] } : ts
      ),
    })),

  executeTerminalCommand: (cmd) => {
    let { terminalSessions, activeTerminalId, workspacePath } = get();
    set({ terminalOpen: true });
    
    if (terminalSessions.length === 0) {
      get().createTerminalSession();
      const updated = get();
      terminalSessions = updated.terminalSessions;
      activeTerminalId = updated.activeTerminalId;
    }
    
    if (!activeTerminalId && terminalSessions.length > 0) {
      activeTerminalId = terminalSessions[0].id;
      set({ activeTerminalId });
    }

    const sessionId = activeTerminalId;
    if (sessionId) {
      const cwd = get().terminalCwd || workspacePath || "/";
      get().pushTerminalHistory(sessionId, cmd);
      get().appendTerminalLine(sessionId, { id: nextLineId(), text: `$ ${cmd}`, stream: "input" });
      get().setTerminalRunning(sessionId, true);
      
      // We invoke it but don't await because we want the terminal to naturally receive the output 
      // via events. Errors firing the command will be caught and appended as system/stderr lines.
      // (invoke is available globally if imported, but we don't have invoke imported here...)
      // Wait, we need invoke from @tauri-apps/api/core. I will import it.
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("run_terminal_command", { sessionId, cmd, cwd }).catch((e: any) => {
          get().appendTerminalLine(sessionId, { id: nextLineId(), text: `Error: ${e}`, stream: "stderr" });
          get().setTerminalRunning(sessionId, false);
        });
      });
    }
  },

  // Activity bar / sidebar view
  sidebarView: "files",
  setSidebarView: (v) => set({ sidebarView: v }),
  sidebarVisible: true,
  setSidebarVisible: (v) => set({ sidebarVisible: v }),

  aiPanelMode: "pinned",
  setAiPanelMode: (m) => set({ aiPanelMode: m }),

  // Prompt history
  promptHistory: loadHistory(),
  addPromptHistory: (entry) => {
    const updated = [entry, ...get().promptHistory];
    saveHistory(updated);
    set({ promptHistory: updated });
  },

  // Skills
  skills: [],
  addSkill: (skill) => set((s) => ({ skills: [...s.skills, skill] })),
  removeSkill: (id) => set((s) => ({ skills: s.skills.filter((sk) => sk.id !== id) })),

  // MCP Servers
  mcpServers: [],
  addMCPServer: (server) => set((s) => ({ mcpServers: [...s.mcpServers, server] })),
  removeMCPServer: (id) => set((s) => ({ mcpServers: s.mcpServers.filter((mcp) => mcp.id !== id) })),
}),
    {
      name: 'locai-editor-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projectTabs: state.projectTabs.map(t => ({ // Don't persist file tree nodes directly
          ...t,
          fileTree: []
        })),
        activeProjectTabId: state.activeProjectTabId,
        theme: state.theme,
        settings: state.settings,
        provider: state.provider,
        selectedModel: state.selectedModel,
        sidebarView: state.sidebarView,
        sidebarVisible: state.sidebarVisible,
      }),
      onRehydrateStorage: () => (state) => {
        // Run after hydration completes to sync the active tab's properties into the root properties
        if (state && state.projectTabs.length > 0) {
          const tab = state.projectTabs.find(t => t.id === state.activeProjectTabId) || state.projectTabs[0];
          state.workspacePath = tab.workspacePath;
          state.openFiles = tab.openFiles;
          state.activeFilePath = tab.activeFilePath;
          // Note: fileTree is empty upon hydrate and requires user to read_dir, or we could handle it via invoke later
        }
      }
    }
  )
);
