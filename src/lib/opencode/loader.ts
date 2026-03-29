
import { invoke } from "@tauri-apps/api/core";

export interface OpenCodeMetadata {
  description?: string;
  skills: { name: string; content: string }[];
  agents: { name: string; content: string }[];
  tools: { name: string; content: string }[];
}

/**
 * Loads skills and metadata from .opencode directory if it exists.
 * Will scan for .opencode at workspace level.
 */
export async function loadOpenCode(workspacePath: string): Promise<OpenCodeMetadata | null> {
  const opencodeDir = `${workspacePath}/.opencode`;
  try {
    // Try to see if this directory exists
    // (a simple ls should suffice, but we can also use read_dir if we have one)
    // For now we'll use read_dir via invoke if we can, or we'll wrap it.
    
    const results: OpenCodeMetadata = {
      skills: [],
      agents: [],
      tools: [],
    };

    // Load agents from .opencode/agent
    try {
      const agentFiles = await invoke<any[]>("read_dir_shallow", { path: `${opencodeDir}/agent` });
      for (const f of agentFiles) {
        if (!f.isDir) {
          const content = await invoke<string>("read_file", { path: `${opencodeDir}/agent/${f.name}` });
          results.agents.push({ name: f.name, content });
        }
      }
    } catch { /* ignore not found */ }

    // Load tools from .opencode/tool
    try {
      const toolFiles = await invoke<any[]>("read_dir_shallow", { path: `${opencodeDir}/tool` });
      for (const f of toolFiles) {
        if (!f.isDir) {
          const content = await invoke<string>("read_file", { path: `${opencodeDir}/tool/${f.name}` });
          results.tools.push({ name: f.name, content });
        }
      }
    } catch { /* ignore not found */ }

    // Check if there are skill subdirectories (like .opencode/skills/name/SKILL.md)
    try {
      const skillDirs = await invoke<any[]>("read_dir_shallow", { path: `${opencodeDir}/skills` });
      for (const d of skillDirs) {
        if (d.isDir) {
           try {
             const skillContent = await invoke<string>("read_file", { path: `${opencodeDir}/skills/${d.name}/SKILL.md` });
             results.skills.push({ name: d.name, content: skillContent });
           } catch { /* ignore if no SKILL.md */ }
        }
      }
    } catch { /* ignore not found */ }

    return results;
  } catch (e) {
    console.warn("OpenCode structure not found or accessible:", e);
    return null;
  }
}
