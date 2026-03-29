
/**
 * Utility functions for LLM interaction, parsing, and thinking process handling.
 */

/**
 * Strips XML tool blocks from text for display.
 */
export function stripToolBlocks(text: string): string {
  return text.replace(/<TOOL\s+name=["'][\w_]+["']>[\.\s\S]*?<\/TOOL>/gi, "").trim();
}

/**
 * Parses XML <TOOL name="...">...</TOOL> blocks from LLM text.
 */
export function parseToolCalls(text: string) {
  const results: { id: string; name: string; argsRaw: string; args: Record<string, any> }[] = [];
  // Match <TOOL name="...">...</TOOL> — content can span multiple lines
  const re = /<TOOL\s+name=["']([\w_]+)["']>([\.\s\S]*?)<\/TOOL>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const argsRaw = m[2].trim();
    let args: Record<string, any> = {};
    try {
      args = JSON.parse(argsRaw);
    } catch {
      /* fallback if JSON is not perfectly formatted */
    }
    results.push({
      id: `t_${Date.now()}_${idx++}`,
      name,
      argsRaw,
      args
    });
  }
  return results;
}

/**
 * Cleans thinking process and labels from LLM responses.
 * Especially useful for some local models that might emit <think> or <label> tags.
 */
export function processThinkTags(content: string): string {
  // Replace <think>...</think> with empty string or keep it for the UI/display.
  // In MessageBubble we render it separately.
  return content; 
}

/**
 * Strips <think>...</think> blocks from code content.
 * Some local models mistakenly include their thinking process in the tool arguments.
 */
export function cleanThinkFromCode(code: string): string {
  return code.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
