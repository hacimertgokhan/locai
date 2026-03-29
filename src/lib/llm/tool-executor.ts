
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { AgentToolCall, SearchMatch } from "../../types";
import { cleanThinkFromCode } from "./utils";

/**
 * Executes a single tool call from the agent.
 */
export async function executeToolCall(
  call: AgentToolCall,
  workspacePath: string,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return "Error: Invalid tool arguments (JSON parse failed)";
  }

  const resolve = (p: string) =>
    p.startsWith("/") ? p : `${workspacePath}/${p.replace(/^\.\//, "")}`;

  try {
    switch (call.function.name) {
      case "read_file":
        return (await invoke<string>("read_file", { path: resolve(args.path as string) })).slice(0, 12000);

      case "write_file": {
        const content = cleanThinkFromCode(args.content as string);
        return await invoke<string>("agent_write_file", {
          path: resolve(args.path as string),
          content: content,
        });
      }

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

      case "run_terminal_command":
        useEditorStore.getState().executeTerminalCommand(args.command as string);
        return "Command started in the terminal panel.";

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

      case "http_request": {
        const response = await invoke<{
          ok: boolean;
          status: number;
          status_text: string;
          elapsed_ms: number;
          body: string;
        }>("http_request", {
          input: {
            method: (args.method as string) || "GET",
            url: (args.url as string) || "",
            headers: (args.headers as Record<string, string>) || {},
            body: (args.body as string) || "",
            timeout_ms: (args.timeout_ms as number) || 20000,
          },
        });

        const bodyPreview = response.body.length > 2500
          ? `${response.body.slice(0, 2500)}...`
          : response.body;

        return `HTTP ${response.status} ${response.status_text} (${response.elapsed_ms}ms)\n${bodyPreview}`;
      }

      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (e: unknown) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
