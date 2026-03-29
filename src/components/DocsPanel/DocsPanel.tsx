import { useMemo, useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import "./DocsPanel.css";

const DOC_TYPES = [
  { id: "full", label: "Full Project Documentation", file: "docs/PROJECT_OVERVIEW.md" },
  { id: "api", label: "API Documentation", file: "docs/API_REFERENCE.md" },
  { id: "onboard", label: "Setup and Onboarding", file: "docs/ONBOARDING.md" },
] as const;

export function DocsPanel() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const dispatchAITask = useEditorStore((s) => s.dispatchAITask);

  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]["id"]>("full");
  const [targetPath, setTargetPath] = useState("docs/PROJECT_OVERVIEW.md");
  const [extraScope, setExtraScope] = useState("");

  const selectedDoc = useMemo(() => DOC_TYPES.find((d) => d.id === docType) ?? DOC_TYPES[0], [docType]);

  const handleDocType = (nextType: (typeof DOC_TYPES)[number]["id"]) => {
    setDocType(nextType);
    const found = DOC_TYPES.find((d) => d.id === nextType);
    if (found) setTargetPath(found.file);
  };

  const handleGenerate = () => {
    if (!workspacePath) return;

    const scopeLine = extraScope.trim()
      ? `Extra scope: ${extraScope.trim()}`
      : "Extra scope: none."
;

    const prompt = [
      `Create ${selectedDoc.label.toLowerCase()} for this project.`,
      "Use agent mode: inspect the repository first, then create/update the documentation file.",
      `Target file: ${targetPath.trim() || selectedDoc.file}`,
      `Project type: ${projectInfo.type}${projectInfo.framework ? ` (${projectInfo.framework})` : ""}`,
      scopeLine,
      "The document must include:",
      "- Project purpose and architecture overview",
      "- Directory structure and critical files",
      "- Run/build/test commands",
      "- Technical decisions, dependencies, and risks",
      "- Development workflow and release flow",
      "Do not just reply in chat. Create or update the file directly, then provide a short summary.",
    ].join("\n");

    dispatchAITask({
      prompt,
      mode: "agent",
      autoSend: true,
    });
  };

  return (
    <div className="docs-panel">
      <div className="docs-header">
        <span className="docs-title">AI DOCS BUILDER</span>
      </div>

      <div className="docs-body">
        {!workspacePath && <div className="docs-empty">Open a project folder first to generate documentation.</div>}

        {workspacePath && (
          <>
            <div className="docs-field">
              <label>Document Type</label>
              <div className="docs-options">
                {DOC_TYPES.map((item) => (
                  <button
                    key={item.id}
                    className={`docs-chip ${docType === item.id ? "active" : ""}`}
                    onClick={() => handleDocType(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="docs-field">
              <label>Target File</label>
              <input
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="docs/PROJECT_OVERVIEW.md"
              />
            </div>

            <div className="docs-field">
              <label>Extra Scope (Optional)</label>
              <textarea
                rows={5}
                value={extraScope}
                onChange={(e) => setExtraScope(e.target.value)}
                placeholder="Example: deployment steps, env variables, event lifecycle"
              />
            </div>

            <button className="docs-run" onClick={handleGenerate}>
              Generate Documentation with AI
            </button>
          </>
        )}
      </div>
    </div>
  );
}
