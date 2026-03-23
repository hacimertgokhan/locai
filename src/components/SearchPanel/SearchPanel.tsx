import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { SearchMatch } from "../../types";
import "./SearchPanel.css";

type GroupedResults = Record<string, SearchMatch[]>;

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<GroupedResults>({});
  const [searching, setSearching] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);
  const [replaceMsg, setReplaceMsg] = useState("");
  const workspacePath = useEditorStore((s) => s.workspacePath);
  const openFile = useEditorStore((s) => s.openFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const openFiles = useEditorStore((s) => s.openFiles);
  const searchTimer = useRef<number | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !workspacePath) {
      setResults({});
      setTotalMatches(0);
      return;
    }
    setSearching(true);
    try {
      const matches = await invoke<SearchMatch[]>("search_in_files", {
        root: workspacePath,
        query: q,
        caseSensitive,
      });
      const grouped: GroupedResults = {};
      for (const m of matches) {
        if (!grouped[m.file]) grouped[m.file] = [];
        grouped[m.file].push(m);
      }
      setResults(grouped);
      setTotalMatches(matches.length);
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setSearching(false);
    }
  }, [workspacePath, caseSensitive]);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    setReplaceMsg("");
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => doSearch(v), 300);
  };

  const openFileAtLine = async (file: string, _lineNum: number) => {
    if (!workspacePath) return;
    const fullPath = `${workspacePath}/${file}`;
    const existing = openFiles.find(f => f.path === fullPath);
    if (existing) {
      setActiveFile(fullPath);
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path: fullPath });
      const language = await invoke<string>("get_file_language", { path: fullPath });
      const name = file.split("/").pop() ?? file;
      openFile({ path: fullPath, name, content, language, isDirty: false });
    } catch (e) {
      console.error("Open failed:", e);
    }
  };

  const handleReplaceFile = async (file: string) => {
    if (!replace || !workspacePath) return;
    const fullPath = `${workspacePath}/${file}`;
    try {
      const count = await invoke<number>("replace_in_file", {
        filePath: fullPath,
        query,
        replacement: replace,
        caseSensitive,
      });
      setReplaceMsg(`Replaced ${count} occurrence${count !== 1 ? "s" : ""} in ${file}`);
      doSearch(query);
    } catch (e: any) {
      setReplaceMsg(`Error: ${e}`);
    }
  };

  const handleReplaceAll = async () => {
    if (!replace || !workspacePath || !query) return;
    let total = 0;
    for (const file of Object.keys(results)) {
      const fullPath = `${workspacePath}/${file}`;
      try {
        const count = await invoke<number>("replace_in_file", {
          filePath: fullPath,
          query,
          replacement: replace,
          caseSensitive,
        });
        total += count;
      } catch {}
    }
    setReplaceMsg(`Replaced ${total} occurrence${total !== 1 ? "s" : ""} across ${Object.keys(results).length} files`);
    doSearch(query);
  };

  const fileCount = Object.keys(results).length;

  return (
    <div className="search-panel">
      <div className="search-header">
        <span className="search-title">SEARCH</span>
        <button
          className={`search-replace-toggle ${showReplace ? "active" : ""}`}
          onClick={() => setShowReplace(!showReplace)}
          title="Toggle replace"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 7V5h-2V3.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5V5H8V3.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5V5H4V3.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V11h2v1.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V11h2v1.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V9h2V7h-2z"/>
          </svg>
        </button>
      </div>

      <div className="search-inputs">
        <div className="search-field">
          <input
            className="search-input"
            placeholder="Search in files…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
          />
          <button
            className={`search-option ${caseSensitive ? "active" : ""}`}
            onClick={() => { setCaseSensitive(!caseSensitive); doSearch(query); }}
            title="Match case"
          >
            Aa
          </button>
          {searching && <span className="search-spinner">…</span>}
        </div>

        {showReplace && (
          <div className="search-field">
            <input
              className="search-input"
              placeholder="Replace with…"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleReplaceAll()}
            />
            <button
              className="search-replace-btn"
              onClick={handleReplaceAll}
              disabled={!replace || !query}
              title="Replace all"
            >
              All
            </button>
          </div>
        )}
      </div>

      {replaceMsg && (
        <div className="search-replace-msg">{replaceMsg}</div>
      )}

      {query && (
        <div className="search-stats">
          {searching ? "Searching…" : `${totalMatches} result${totalMatches !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`}
        </div>
      )}

      <div className="search-results">
        {Object.entries(results).map(([file, matches]) => (
          <div key={file} className="search-file-group">
            <div className="search-file-header">
              <span className="search-file-name">{file.split("/").pop()}</span>
              <span className="search-file-path">{file.includes("/") ? file.split("/").slice(0, -1).join("/") : ""}</span>
              <span className="search-file-count">{matches.length}</span>
              {showReplace && replace && (
                <button
                  className="search-replace-file-btn"
                  onClick={() => handleReplaceFile(file)}
                  title={`Replace in ${file}`}
                >
                  ↻
                </button>
              )}
            </div>
            {matches.map((m, i) => (
              <div
                key={i}
                className="search-match"
                onClick={() => openFileAtLine(m.file, m.lineNum)}
              >
                <span className="search-match-line">{m.lineNum}</span>
                <span className="search-match-text">
                  {m.text.slice(0, m.colStart)}
                  <mark className="search-match-hl">
                    {m.text.slice(m.colStart, m.colEnd)}
                  </mark>
                  {m.text.slice(m.colEnd)}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!workspacePath && (
          <div className="search-hint">Open a folder to search</div>
        )}
      </div>
    </div>
  );
}
