import { Header } from "./components/Header";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PermissionModal } from "./components/PermissionModal";

export function App() {
  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-zinc-100">
      <Header />
      <MessageList />
      <Composer />
      <PermissionModal />
    </div>
  );
}
