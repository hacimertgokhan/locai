import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { ModelInfo } from "../../types";
import { LLMProvider, useEditorStore } from "../../store/editorStore";
import "./SidebarModelPicker.css";

export function SidebarModelPicker() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = useEditorStore((s) => s.provider);
  const setProvider = useEditorStore((s) => s.setProvider);
  const selectedModel = useEditorStore((s) => s.selectedModel);
  const setSelectedModel = useEditorStore((s) => s.setSelectedModel);
  const settings = useEditorStore((s) => s.settings);
  const isAiBusy = useEditorStore((s) => s.isAiBusy);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result: ModelInfo[] =
        provider === "ollama"
          ? await invoke("list_ollama_models", { baseUrl: settings.ollamaUrl })
          : await invoke("list_lmstudio_models", { baseUrl: settings.lmstudioUrl });
      setModels(result);
      if (result.length > 0 && !selectedModel) {
        setSelectedModel(result[0].id);
      }
    } catch {
      setError(`Cannot reach ${provider === "ollama" ? "Ollama" : "LM Studio"}`);
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [provider, settings.ollamaUrl, settings.lmstudioUrl]);

  return (
    <div className="sidebar-model-picker">
      <div className="smp-title">AI Setup</div>

      <div className="smp-provider-tabs">
        {(["ollama", "lmstudio"] as LLMProvider[]).map((p) => (
          <button
            key={p}
            className={`smp-provider-tab ${provider === p ? "active" : ""}`}
            onClick={() => {
              setProvider(p);
              setSelectedModel("");
              setModels([]);
            }}
          >
            {p === "ollama" ? "Ollama" : "LM Studio"}
          </button>
        ))}
      </div>

      <div className="smp-model-row">
        <select
          className="smp-model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading || models.length === 0}
        >
          {loading && <option value="">Loading models...</option>}
          {!loading && models.length === 0 && <option value="">No models available</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id.split("/").pop()}
            </option>
          ))}
        </select>

        <button className="smp-refresh" onClick={fetchModels} title="Refresh Models">
          <RefreshCw size={12} className={loading ? "ai-spin" : ""} />
        </button>
      </div>

      {error && <div className="smp-error">{error}</div>}

      {isAiBusy && (
        <div className="smp-thinking">
          <span className="smp-thinking-dot" />
          <span>AI is thinking...</span>
        </div>
      )}
    </div>
  );
}
