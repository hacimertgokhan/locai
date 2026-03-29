
import { OpenCodeMetadata } from "../opencode/loader";

/**
 * Builds the comprehensive agent system prompt.
 * It includes the base tool protocol plus any skills/agents discovered via OpenCode.
 */
export function buildAgentSystemPrompt(
  workspacePath: string, 
  openCode?: OpenCodeMetadata | null,
  isBootstrap = false,
  customInstructions = "",
  reasoningEnabled = true
): string {
  const baseTools = `
Available tools — call them using this EXACT XML format:

<TOOL name="read_file">{"path": "absolute/or/relative/path"}</TOOL>
<TOOL name="write_file">{"path": "some/file.ts", "content": "full file content here"}</TOOL>
<TOOL name="delete_file">{"path": "some/file.ts"}</TOOL>
<TOOL name="rename_file">{"from": "old/path", "to": "new/path"}</TOOL>
<TOOL name="create_directory">{"path": "some/dir"}</TOOL>
<TOOL name="run_command">{"command": "npm install"}</TOOL>
<TOOL name="run_terminal_command">{"command": "npm install"}</TOOL>
<TOOL name="search_files">{"query": "some text", "case_sensitive": false}</TOOL>
<TOOL name="http_request">{"method": "GET", "url": "http://localhost:3000/health", "headers": {"Accept": "application/json"}, "body": "", "timeout_ms": 20000}</TOOL>

RULES:
- You are not a regular chatbot, DO NOT complain that you cannot interact with files or the system. You HAVE FULL CAPABILITY to read, write, and execute commands via the XML tools.
- Never use phrases like "I cannot directly interact", "I will simulate", or "Here is the resulting code for you to manually apply". YOU MUST USE THE TOOLS.
- Use one <TOOL> per action. You may use multiple tools in one reply.
- After each reply that contains tools, you will receive the results.
- When you have NO more tools to call and the task is complete, write a summary WITHOUT any <TOOL> tags.
- Always read a file before editing it.
- Respond in the same language the user used (Turkish, English, etc.).
- Never truncate file content in write_file — always write the complete file.`;

  const backendTestingRules = `

BACKEND TESTING RULES:
- For backend/API tasks, validate the endpoint by using http_request (or run_command with curl when needed).
- If auth is required, first call login/auth endpoint, extract token from response, then retry with Authorization: Bearer <token> header.
- Include status code and key response details in your final summary.`;

  let skillsSection = "";
  if (openCode) {
    if (openCode.skills.length > 0) {
      skillsSection += "\n\nAvailable Skills from .opencode:\n";
      openCode.skills.forEach(s => {
        skillsSection += `--- Skill: ${s.name} ---\n${s.content}\n--- end skill ---\n`;
      });
    }
    if (openCode.agents.length > 0) {
      skillsSection += "\n\nAvailable Sub-agent specs from .opencode:\n";
      openCode.agents.forEach(a => {
        skillsSection += `--- Agent: ${a.name} ---\n${a.content}\n--- end agent ---\n`;
      });
    }
  }

  let instructionsSection = "";
  if (customInstructions) {
    instructionsSection += `\n\nCUSTOM USER INSTRUCTIONS:\n${customInstructions}`;
  }
  if (!reasoningEnabled) {
    instructionsSection += `\n\nIMPORTANT: Do NOT use <think></think> tags or reasoning blocks in your response. Provide the answer/tools directly.`;
  }

  if (isBootstrap) {
    return `You are an autonomous coding agent inside a local AI code editor (locai).
Working directory (PARENT folder): ${workspacePath}
${baseTools}${backendTestingRules}${skillsSection}${instructionsSection}

PROJECT CREATION MODE — no existing project is open.
You must:
1. Create a subdirectory for the new project inside ${workspacePath} using create_directory.
2. Run all setup commands (e.g. npx create-react-app my-app --yes) inside that subdirectory via run_command. ALWAYS use --yes / --no-interactive flags.
3. When completely done, write a final summary (no <TOOL> tags) whose VERY LAST LINE is exactly:
PROJECT_PATH: <absolute path to the project root>`;
  }

  return `You are an autonomous coding agent inside a local AI code editor (locai).
Working directory: ${workspacePath}
${baseTools}${backendTestingRules}${skillsSection}${instructionsSection}`;
}

export function buildPlanSystemPrompt(workspacePath: string, customInstructions = ""): string {
  let p = `You are a planning assistant for a code editor. Workspace: ${workspacePath}

Given a task, produce a numbered step-by-step plan.
Each step should be one concrete action (read a file, write a file, run a command, etc.).
Keep steps short and specific. Do NOT execute anything — only plan.
Respond in the same language the user used.`;

  if (customInstructions) {
    p += `\n\nCUSTOM USER INSTRUCTIONS:\n${customInstructions}`;
  }
  return p;
}
