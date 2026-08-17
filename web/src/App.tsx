import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";

const STORAGE_KEY = "clew-sidebar-open";

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(STORAGE_KEY) !== "closed",
  );

  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      localStorage.setItem(STORAGE_KEY, open ? "closed" : "open");
      return !open;
    });

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if (e.code !== "KeyB" || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-app text-fg">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar onClose={toggleSidebar} />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {!sidebarOpen && (
            <button
              className="absolute left-2 top-2 z-10 rounded-md p-1.5 text-fg-subtle hover:bg-hover hover:text-fg"
              title="サイドバーを開く"
              onClick={toggleSidebar}
            >
              <PanelLeft size={16} />
            </button>
          )}
          <MessageList />
          <Composer />
        </div>
      </div>
    </div>
  );
}
