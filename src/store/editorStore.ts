import { create } from "zustand";
import { DiffHunk, Session, ChatMessage, Theme } from "../types";

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string; // before AI edit
  language: string;
  isDirty: boolean;
}

export type LLMProvider = "ollama" | "lmstudio";

export interface Settings {
  ollamaUrl: string;
  lmstudioUrl: string;
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

function newSession(): Session {
  const now = Date.now();
  return {
    id: `s_${now}`,
    name: `Session ${new Date(now).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
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

// ── Store ─────────────────────────────────────────────────────────
interface EditorState {
  // Workspace
  workspacePath: string | null;
  setWorkspacePath: (path: string | null) => void;

  // Open files
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (file: Omit<OpenFile, "originalContent">) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;

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
}

const { sessions: initialSessions, activeId } = getOrCreateActiveSession(loadSessions());
saveSessions(initialSessions);

export const useEditorStore = create<EditorState>((set, get) => ({
  workspacePath: null,
  setWorkspacePath: (path) => set({ workspacePath: path }),

  openFiles: [],
  activeFilePath: null,

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

  // Sessions
  sessions: initialSessions,
  activeSessionId: activeId,
  showSessions: false,
  setShowSessions: (showSessions) => set({ showSessions }),

  createSession: () => {
    const s = newSession();
    const sessions = [...get().sessions, s];
    saveSessions(sessions);
    localStorage.setItem(ACTIVE_SESSION_KEY, s.id);
    set({ sessions, activeSessionId: s.id, showSessions: false });
  },

  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    if (sessions.length === 0) {
      const s = newSession();
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
}));
