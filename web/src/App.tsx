import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";

const STORAGE_KEY = "clew-sidebar-open";
const WIDTH_KEY = "clew-sidebar-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;

const clampWidth = (px: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(STORAGE_KEY) !== "closed",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : DEFAULT_WIDTH;
  });

  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      localStorage.setItem(STORAGE_KEY, open ? "closed" : "open");
      return !open;
    });

  // ドラッグ中はサイドバーの外にカーソルが出るので、windowで拾う
  const startResize = () => {
    const onMove = (e: MouseEvent) => setSidebarWidth(clampWidth(e.clientX));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(WIDTH_KEY, String(clampWidth(e.clientX)));
    };
    document.body.style.cursor = "col-resize";
    // ドラッグ中に本文が選択されるのを止める
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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
        {sidebarOpen && (
          <Sidebar onClose={toggleSidebar} width={sidebarWidth} onResizeStart={startResize} />
        )}
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
