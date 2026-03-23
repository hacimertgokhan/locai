import { useState } from "react";
import { AgentStep } from "../../types";
import "./AgentSteps.css";

// ── Icon per tool ──────────────────────────────────────────────────
function toolIcon(name: string): string {
  switch (name) {
    case "read_file":      return "📄";
    case "write_file":     return "✏️";
    case "delete_file":    return "🗑";
    case "rename_file":    return "↩️";
    case "create_directory": return "📁";
    case "run_command":    return "⚡";
    case "search_files":   return "🔍";
    default:               return "🔧";
  }
}

// ── Human-readable label ───────────────────────────────────────────
function toolLabel(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "read_file":
      return `Read ${shortPath(args.path as string)}`;
    case "write_file":
      return `Write ${shortPath(args.path as string)}`;
    case "delete_file":
      return `Delete ${shortPath(args.path as string)}`;
    case "rename_file":
      return `Rename ${shortPath(args.from as string)} → ${shortPath(args.to as string)}`;
    case "create_directory":
      return `Create dir ${shortPath(args.path as string)}`;
    case "run_command":
      return `Run: ${String(args.command ?? "").slice(0, 50)}`;
    case "search_files":
      return `Search "${args.query}"`;
    default:
      return tool;
  }
}

function shortPath(p: string | undefined): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}

// ── Single step row ────────────────────────────────────────────────
function StepRow({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(step.tool, step.args);
  const icon = toolIcon(step.tool);

  return (
    <div className={`agent-step agent-step-${step.status}`}>
      <button className="agent-step-hd" onClick={() => setOpen(!open)}>
        <span className="agent-step-icon">{icon}</span>
        <span className="agent-step-label">{label}</span>
        <span className={`agent-step-badge agent-step-badge-${step.status}`}>
          {step.status === "running" ? "…" : step.status === "error" ? "err" : "ok"}
        </span>
        {step.result && (
          <span className="agent-step-expand">{open ? "▲" : "▼"}</span>
        )}
      </button>
      {open && step.result && (
        <pre className="agent-step-result">{step.result.slice(0, 600)}</pre>
      )}
    </div>
  );
}

// ── Steps list (embedded in a chat message) ────────────────────────
export function AgentStepList({
  steps,
  isRunning,
}: {
  steps: AgentStep[];
  isRunning: boolean;
}) {
  if (steps.length === 0 && !isRunning) return null;

  return (
    <div className="agent-steps">
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
      {isRunning && steps.length === 0 && (
        <div className="agent-step-thinking">
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 11 }}>thinking…</span>
        </div>
      )}
    </div>
  );
}
