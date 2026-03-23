export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[] | null;
}

export interface DiffHunk {
  id: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
  kind: "Add" | "Remove" | "Change";
}

export interface ModelInfo {
  id: string;
  provider: string;
}

export type Theme = "dark" | "light" | "grey";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  hunks?: DiffHunk[];
  modifiedContent?: string;
  filePath?: string;
  agentSteps?: AgentStep[];
  timestamp: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  workspacePath?: string | null;
}

// ── Terminal ──────────────────────────────────────────────────────
export interface TerminalLine {
  id: number;
  text: string;
  stream: "stdout" | "stderr" | "system" | "input";
}

export interface TerminalSession {
  id: string;
  name: string;
  lines: TerminalLine[];
  cwd: string;
  running: boolean;
  history: string[];
  historyIdx: number;
}

// ── Search ────────────────────────────────────────────────────────
export interface SearchMatch {
  file: string;
  lineNum: number;
  text: string;
  colStart: number;
  colEnd: number;
}

// ── Prompt History ────────────────────────────────────────────────
export interface PromptHistoryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  workspacePath: string;
  files: {
    path: string;
    name: string;
    beforeContent: string;
    afterContent: string;
    hunks: DiffHunk[];
  }[];
}

// ── Agent ─────────────────────────────────────────────────────────

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export type LlmStepResult =
  | { type: "tool_calls"; tool_calls: AgentToolCall[]; assistant_message: AgentMessage }
  | { type: "content"; content: string };

export interface AgentStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error";
}

// ── Git ───────────────────────────────────────────────────────────
export interface GitStatusEntry {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitCommit {
  id: string;
  message: string;
  author: string;
  time: number;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
}
