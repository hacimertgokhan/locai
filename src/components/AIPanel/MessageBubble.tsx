
import { useEditorStore } from "../../store/editorStore";
import { DiffHunk, AgentStep } from "../../types";
import { AgentStepList } from "./AgentSteps";
import { User, Bot, Check, FileCode, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  hunks?: DiffHunk[];
  modifiedContent?: string;
  filePath?: string;
  agentSteps?: AgentStep[];
}

const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function formatUrlLabel(rawUrl: string) {
  const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const summary = `${host}${path}`;
    return summary.length > 44 ? `${summary.slice(0, 41)}...` : summary;
  } catch {
    return rawUrl;
  }
}

function normalizePlainUrls(raw: string) {
  const parts = raw.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part.replace(URL_REGEX, (match, offset: number) => {
        const prev = part.slice(Math.max(0, offset - 2), offset);
        if (prev === "](" || prev === "!(") return match;

        const trailing = (match.match(/[),.;!?]+$/) ?? [""])[0];
        const clean = trailing ? match.slice(0, -trailing.length) : match;
        const href = clean.startsWith("http") ? clean : `https://${clean}`;
        const label = formatUrlLabel(clean);
        return `[${label}](${href})${trailing}`;
      });
    })
    .join("");
}

function toPlainText(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((n) => toPlainText(n)).join("");
  if (node?.props?.children) return toPlainText(node.props.children);
  return "";
}

export function MessageBubble({
  role, content, hunks, modifiedContent, filePath, agentSteps,
}: MessageBubbleProps) {
  const setDiff = useEditorStore((s) => s.setDiff);

  const handleViewDiff = () => {
    if (hunks && modifiedContent) {
      setDiff(hunks, modifiedContent);
    }
  };

  const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const displayContent = role === "assistant" ? normalizePlainUrls(cleanContent) : cleanContent;

  return (
    <div className={`msg msg-${role}`}>
      <div className="msg-role" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {role === "user" ? <User size={12} /> : <Bot size={12} />}
        {role === "user" ? "USER" : "ASSISTANT"}
      </div>
      <div className="msg-body">
        {filePath && (
          <div className="msg-file">
             <FileCode size={11} style={{ marginRight: 6 }} />
             {filePath.split("/").pop()}
          </div>
        )}
        
        {/* Agent steps */}
        {agentSteps && agentSteps.length > 0 && (
          <AgentStepList steps={agentSteps} isRunning={false} />
        )}

        <div className="msg-text">
          <ReactMarkdown
            components={{
              a({ href, children, ...props }: any) {
                const label = toPlainText(children).trim();
                const friendlyLabel = href ? formatUrlLabel(href) : label;
                const showFriendly = label === href || /^https?:\/\//i.test(label) || /^www\./i.test(label);
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="msg-link" {...props}>
                    <span>{showFriendly ? friendlyLabel : label}</span>
                    <span className="msg-link-tag">Source</span>
                  </a>
                );
              },
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={oneDark as any}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      borderRadius: "6px",
                      margin: "12px 0",
                      fontSize: "12px",
                      border: "1px solid var(--corporate-border)",
                    }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>

        {hunks && hunks.length > 0 && (
          <div className="msg-applied-label">
            <Check size={12} style={{ marginRight: 6 }} />
            Applied {hunks.length} changes
          </div>
        )}

        {hunks && hunks.length > 0 && (
          <div className="msg-hunks">
            {hunks.map((h) => (
              <div key={h.id} className={`msg-hunk msg-hunk-${h.kind.toLowerCase()}`}>
                <span className="msg-hunk-kind">{h.kind === 'Change' ? 'Modify' : h.kind}</span>
                <span className="msg-hunk-loc">line {h.oldStart}</span>
              </div>
            ))}
            {modifiedContent && (
              <button className="msg-view-diff" onClick={handleViewDiff}>
                <ExternalLink size={11} style={{ marginRight: 6 }} />
                VIEW IN EDITOR
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
