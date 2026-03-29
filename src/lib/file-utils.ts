
import { FileEntry } from "../types";

// Matches: ./app/page.tsx  app/page.tsx  components/Foo.tsx  etc.
const FILE_PATTERN = /(?:^|[\s"'`(,])(\.{0,2}\/[^\s"'`),]+\.[a-zA-Z]{1,10}|[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-.]+)+\.[a-zA-Z]{1,10})(?:$|[\s"'`),])/g;
const MENTION_PATTERN = /@([a-zA-Z0-9_\-./]+)/g;

/**
 * Detects file paths and @mentions in a given text.
 */
export function detectFilePaths(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_PATTERN.lastIndex = 0;
  while ((m = FILE_PATTERN.exec(text)) !== null) {
    let p = m[1];
    if (p.startsWith("./")) p = p.slice(2);
    if (!p || p.startsWith("..") || !p.includes(".") || p.length < 4) continue;
    found.add(p);
  }
  
  MENTION_PATTERN.lastIndex = 0;
  while ((m = MENTION_PATTERN.exec(text)) !== null) {
    if (m[1] && m[1].length > 0) found.add(m[1]);
  }
  return Array.from(found);
}

/**
 * Searches for a node in the file tree by name or path.
 */
export function findNodeInTree(nodes: FileEntry[], query: string): string | null {
  for (const n of nodes) {
    if (n.path.endsWith(query) || n.name === query) {
      if (!n.isDir) return n.path;
    }
    if (n.children && n.children.length > 0) {
      const found = findNodeInTree(n.children, query);
      if (found) return found;
    }
  }
  return null;
}
