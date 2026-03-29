import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import "./ApiTestPanel.css";

type DiscoveredEndpoint = {
  method: string;
  path: string;
  file: string;
  line: number;
};

type HttpResult = {
  ok: boolean;
  status: number;
  status_text: string;
  elapsed_ms: number;
  headers: [string, string][];
  body: string;
};

function parseHeaderLines(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    });
  return headers;
}

function readByPath(input: unknown, path: string): string | null {
  if (!path.trim()) return null;
  const keys = path.split(".").map((k) => k.trim()).filter(Boolean);
  let current: any = input;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}

export function ApiTestPanel() {
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const dispatchAITask = useEditorStore((s) => s.dispatchAITask);

  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [pathInput, setPathInput] = useState("/api/health");
  const [method, setMethod] = useState("GET");
  const [headersRaw, setHeadersRaw] = useState("Content-Type: application/json");
  const [body, setBody] = useState("");
  const [timeout, setTimeoutMs] = useState("20000");
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState<"body" | "headers" | "auth">("body");

  const [endpoints, setEndpoints] = useState<DiscoveredEndpoint[]>([]);
  const [endpointQuery, setEndpointQuery] = useState("");
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);

  const [loginUrl, setLoginUrl] = useState("http://localhost:3000/api/auth/login");
  const [loginBody, setLoginBody] = useState('{"email":"test@example.com","password":"123456"}');
  const [tokenPath, setTokenPath] = useState("token");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HttpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = useMemo(() => {
    const raw = pathInput.trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = baseUrl.trim().replace(/\/$/, "");
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return `${base}${path}`;
  }, [baseUrl, pathInput]);

  const loadEndpoints = async () => {
    if (!workspacePath) {
      setEndpoints([]);
      return;
    }
    setLoadingEndpoints(true);
    try {
      const found = await invoke<DiscoveredEndpoint[]>("discover_api_endpoints", { root: workspacePath });
      setEndpoints(found);
    } catch {
      setEndpoints([]);
    } finally {
      setLoadingEndpoints(false);
    }
  };

  useEffect(() => {
    loadEndpoints();
  }, [workspacePath]);

  const mergedHeaders = useMemo(() => {
    const parsed = parseHeaderLines(headersRaw);
    if (token.trim()) {
      parsed.Authorization = `Bearer ${token.trim()}`;
    }
    return parsed;
  }, [headersRaw, token]);

  const filteredEndpoints = useMemo(() => {
    if (!endpointQuery.trim()) return endpoints;
    const q = endpointQuery.toLowerCase();
    return endpoints.filter((e) =>
      e.path.toLowerCase().includes(q) ||
      e.method.toLowerCase().includes(q) ||
      e.file.toLowerCase().includes(q)
    );
  }, [endpoints, endpointQuery]);

  const executeRequest = async (custom?: { url?: string; method?: string; body?: string; headers?: Record<string, string> }) => {
    setRunning(true);
    setError(null);
    try {
      const response = await invoke<HttpResult>("http_request", {
        input: {
          url: custom?.url ?? fullUrl,
          method: custom?.method ?? method,
          headers: custom?.headers ?? mergedHeaders,
          body: custom?.body ?? body,
          timeout_ms: Number(timeout) || 20000,
        },
      });
      setResult(response);
      return response;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setRunning(false);
    }
  };

  const handleLogin = async () => {
    const loginRes = await executeRequest({
      url: loginUrl,
      method: "POST",
      body: loginBody,
      headers: parseHeaderLines(headersRaw),
    });
    if (!loginRes) return;
    try {
      const parsed = JSON.parse(loginRes.body);
      const extracted = readByPath(parsed, tokenPath);
      if (extracted) {
        setToken(extracted);
        setError(null);
      } else {
        setError(`Token path not found: ${tokenPath}`);
      }
    } catch {
      setError("Login response is not valid JSON; token extraction failed.");
    }
  };

  const askAIFromResult = () => {
    if (!result) return;
    const responsePreview = result.body.length > 4500 ? `${result.body.slice(0, 4500)}...` : result.body;
    const prompt = [
      "Backend endpoint test result is below.",
      `Project type: ${projectInfo.type}${projectInfo.framework ? ` (${projectInfo.framework})` : ""}`,
      `Request: ${method} ${fullUrl}`,
      `Status: ${result.status} ${result.status_text}`,
      "Response:",
      responsePreview,
      "Based on this result, find the root cause, inspect relevant files, and apply a permanent fix.",
      "If needed, validate login/token flow as part of the fix.",
    ].join("\n");

    dispatchAITask({ prompt, mode: "agent", autoSend: true });
  };

  return (
    <div className="api-panel">
      <div className="api-header">
        <span className="api-title">API TEST LAB</span>
      </div>

      <div className="api-body">
        <aside className="api-sidebar">
          <div className="api-sidebar-top">
            <div className="api-sidebar-title">Endpoints</div>
            <button className="api-ghost" onClick={loadEndpoints} disabled={loadingEndpoints}>
              {loadingEndpoints ? "Scanning..." : "Refresh"}
            </button>
          </div>

          <input
            className="api-search"
            value={endpointQuery}
            onChange={(e) => setEndpointQuery(e.target.value)}
            placeholder="Filter endpoint..."
          />

          <div className="api-endpoint-list">
            {filteredEndpoints.map((ep, i) => (
              <button
                key={`${ep.file}:${ep.line}:${i}`}
                className="api-endpoint-item"
                onClick={() => {
                  setMethod(ep.method);
                  setPathInput(ep.path);
                }}
                title={`${ep.file}:${ep.line}`}
              >
                <span className={`api-method api-method-${ep.method.toLowerCase()}`}>{ep.method}</span>
                <span className="api-path">{ep.path}</span>
              </button>
            ))}
            {!loadingEndpoints && filteredEndpoints.length === 0 && (
              <div className="api-empty">No endpoints found in project files.</div>
            )}
          </div>
        </aside>

        <section className="api-workspace">
          <div className="api-request-bar">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="/api/resource or full URL" />
            <button className="api-btn" onClick={() => executeRequest()} disabled={running}>
              {running ? "Sending..." : "Send"}
            </button>
          </div>

          <div className="api-base-url-row">
            <label>Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:3000" />
            <span className="api-full-url" title={fullUrl}>{fullUrl}</span>
          </div>

          <div className="api-tabs">
            <button className={activeTab === "body" ? "active" : ""} onClick={() => setActiveTab("body")}>Body</button>
            <button className={activeTab === "headers" ? "active" : ""} onClick={() => setActiveTab("headers")}>Headers</button>
            <button className={activeTab === "auth" ? "active" : ""} onClick={() => setActiveTab("auth")}>Auth</button>
          </div>

          <div className="api-editor-card">
            {activeTab === "body" && (
              <textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Request body (JSON, form payload, etc.)"
              />
            )}

            {activeTab === "headers" && (
              <>
                <textarea
                  rows={10}
                  value={headersRaw}
                  onChange={(e) => setHeadersRaw(e.target.value)}
                  placeholder="Header-Name: value"
                />
                <div className="api-inline-row">
                  <label>Timeout (ms)</label>
                  <input value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="20000" />
                </div>
              </>
            )}

            {activeTab === "auth" && (
              <div className="api-auth-grid">
                <input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="Login URL" />
                <textarea rows={5} value={loginBody} onChange={(e) => setLoginBody(e.target.value)} placeholder="Login body JSON" />
                <div className="api-inline-row">
                  <input value={tokenPath} onChange={(e) => setTokenPath(e.target.value)} placeholder="Token path (e.g. data.accessToken)" />
                  <button className="api-btn secondary" onClick={handleLogin} disabled={running}>Fetch Token</button>
                </div>
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" />
              </div>
            )}
          </div>

          {error && <div className="api-error">{error}</div>}

          {result && (
            <div className="api-response-card">
              <div className="api-response-head">
                <span className={result.ok ? "ok" : "bad"}>{result.status} {result.status_text}</span>
                <span>{result.elapsed_ms} ms</span>
              </div>
              <pre>{result.body}</pre>
              <button className="api-btn secondary" onClick={askAIFromResult}>Analyze and Fix with AI</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
