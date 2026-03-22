import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ModelInfo } from "../../types";
import { useEditorStore, LLMProvider } from "../../store/editorStore";

export function ModelSelector() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = useEditorStore((s) => s.provider);
  const setProvider = useEditorStore((s) => s.setProvider);
  const selectedModel = useEditorStore((s) => s.selectedModel);
  const setSelectedModel = useEditorStore((s) => s.setSelectedModel);
  const settings = useEditorStore((s) => s.settings);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result: ModelInfo[] =
        provider === "ollama"
          ? await invoke("list_ollama_models", { baseUrl: settings.ollamaUrl })
          : await invoke("list_lmstudio_models", { baseUrl: settings.lmstudioUrl });
      setModels(result);
      if (result.length > 0 && !selectedModel) setSelectedModel(result[0].id);
    } catch {
      setError(`Cannot reach ${provider === "ollama" ? "Ollama" : "LM Studio"}`);
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchModels(); }, [provider, settings.ollamaUrl, settings.lmstudioUrl]);

  return (
    <div className="model-selector">
      <div className="provider-tabs">
        {(["ollama", "lmstudio"] as LLMProvider[]).map((p) => (
          <button
            key={p}
            className={`provider-tab ${provider === p ? "active" : ""}`}
            onClick={() => { setProvider(p); setSelectedModel(""); setModels([]); }}
          >
            {p === "ollama" ? "Ollama" : "LM Studio"}
          </button>
        ))}
        <button className="refresh-btn" onClick={fetchModels} title="Refresh">↻</button>
      </div>

      {error ? (
        <div className="model-error">{error}</div>
      ) : (
        <select
          className="model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading || models.length === 0}
        >
          {loading && <option value="">Loading…</option>}
          {!loading && models.length === 0 && <option value="">No models</option>}
          {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      )}
    </div>
  );
}
