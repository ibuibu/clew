import { useChatStore } from "../store";
import { ThemeToggle } from "./ThemeToggle";

// グローバルな情報だけを置く。セッション固有の設定はSessionBar（入力欄の上）にある
export function Header() {
  const connected = useChatStore((s) => s.connected);

  return (
    <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
      <span className="font-bold text-accent">⌘ Claude Web</span>
      <span className="ml-auto text-xs text-fg-muted">
        {connected ? "接続済み" : "未接続（リロードで再接続）"}
      </span>
      <ThemeToggle />
    </header>
  );
}
