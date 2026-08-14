import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";

export function App() {
  return (
    <div className="flex h-screen flex-col bg-app text-fg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList />
          <Composer />
        </div>
      </div>
    </div>
  );
}
