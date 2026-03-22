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
  filePath?: string;
  timestamp: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}
