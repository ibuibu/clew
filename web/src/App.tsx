import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PermissionModal } from "./components/PermissionModal";
import { QuestionModal } from "./components/QuestionModal";

export function App() {
  return (
    <div className="flex h-screen flex-col bg-app text-fg">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList />
          <Composer />
        </div>
      </div>
      <PermissionModal />
      <QuestionModal />
    </div>
  );
}
