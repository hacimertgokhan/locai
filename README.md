# locai

A local AI code editor. Open a file, describe what to change, and see the diff inline — no cloud, no API keys.

---

## What it does

locai lets you edit code by describing what you want in plain language. The AI reads your file, generates a modified version, and shows the changes as an inline diff — green for additions, red for removals. You can accept or reject each change individually, or all at once.

Everything runs on your machine. No data leaves your computer.

---

## How it works

1. Open a folder from the sidebar.
2. Click a file to open it in the editor.
3. Select your AI provider and model in the right panel.
4. Type what you want to change — e.g. *"add error handling to this function"* — and press Enter.
5. The AI returns a modified version of your file. Differences appear inline in the editor.
6. Accept or reject each change. Save with `Cmd+S` / `Ctrl+S`.

---

## Requirements

- [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) running locally
- [Rust](https://rustup.rs) 1.75+
- [Node.js](https://nodejs.org) 18+

```bash
ollama pull codestral
```

---

## Getting Started

```bash
git clone https://github.com/hacimertgokhan/locai
cd locai
npm install
npm run tauri dev
```

---

## License

MIT
