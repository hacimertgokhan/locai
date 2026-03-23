import { useEditorStore } from "../../store/editorStore";
import "./ActivityBar.css";

type View = "files" | "git" | "search" | "history" | "skills" | "mcp";

interface ActivityItem {
  view: View;
  title: string;
  icon: React.ReactNode;
}

const items: ActivityItem[] = [
  {
    view: "files",
    title: "Explorer",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    view: "git",
    title: "Source Control",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="5" r="2"/>
        <circle cx="5" cy="19" r="2"/>
        <circle cx="19" cy="19" r="2"/>
        <path d="M12 7v3"/>
        <path d="M12 10c0 3-2 5-7 7"/>
        <path d="M12 10c0 3 2 5 7 7"/>
      </svg>
    ),
  },
  {
    view: "search",
    title: "Search",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
    ),
  },
  {
    view: "history",
    title: "Global History",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
        <path d="M12 7v5l4 2"/>
      </svg>
    ),
  },
  {
    view: "skills",
    title: "Skills",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    view: "mcp",
    title: "MCP Servers",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    ),
  },
];

export function ActivityBar() {
  const sidebarView = useEditorStore((s) => s.sidebarView);
  const setSidebarView = useEditorStore((s) => s.setSidebarView);
  const sidebarVisible = useEditorStore((s) => s.sidebarVisible);
  const setSidebarVisible = useEditorStore((s) => s.setSidebarVisible);

  const handleClick = (view: View) => {
    if (sidebarView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setSidebarView(view);
      setSidebarVisible(true);
    }
  };

  return (
    <div className="activity-bar">
      {items.map((item) => (
        <button
          key={item.view}
          className={`ab-btn ${sidebarView === item.view && sidebarVisible ? "active" : ""}`}
          onClick={() => handleClick(item.view)}
          title={item.title}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
