import {
  ChevronRight,
  Circle,
  CircleAlert,
  FolderInput,
  FolderPlus,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Spool,
  X,
} from "lucide-react";
import { useState } from "react";
import type { SessionGroup } from "@clew/shared";
import { modKeyLabel } from "../platform";
import { useChatStore, type SessionState } from "../store";
import { send } from "../ws";
import { SettingsDialog } from "./SettingsDialog";
import { TagChip } from "./Tags";

const COLLAPSED_KEY = "clew-collapsed-groups";

const loadCollapsed = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

function SessionRow({
  id,
  session,
  onDragStart,
  onDragEnd,
}: {
  id: string;
  session: SessionState;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const groups = useChatStore((s) => s.groups);
  const [moving, setMoving] = useState(false);

  const needsAction = session.permission || session.question;
  const repoName = session.meta.cwd.split("/").slice(-2).join("/");
  const title = session.meta.title || "（無題）";

  const moveTo = (groupId?: string) => {
    send({ type: "set_session_group", sessionId: id, groupId });
    setMoving(false);
  };

  return (
    <>
      <div
        className={`group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 ${
          id === activeId ? "border-accent bg-hover" : "border-transparent hover:bg-hover"
        }`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={() => setActive(id)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm">
            {needsAction && <CircleAlert size={13} className="shrink-0 text-danger" />}
            {session.isRunning && (
              <Circle size={8} fill="currentColor" className="shrink-0 animate-pulse text-accent" />
            )}
            <span className="truncate">{title}</span>
          </div>
          <div className="truncate text-[11px] text-fg-subtle">
            {repoName} · ${session.meta.totalCost.toFixed(3)}
          </div>
          {session.meta.tags && session.meta.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {session.meta.tags.map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          )}
        </div>
        <button
          className="hidden shrink-0 rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg group-hover:block"
          title="名前を変更"
          onClick={(e) => {
            e.stopPropagation();
            const next = prompt("セッション名", title)?.trim();
            if (next) send({ type: "rename_session", sessionId: id, title: next });
          }}
        >
          <Pencil size={14} />
        </button>
        <button
          className="hidden shrink-0 rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg group-hover:block"
          title="グループに移動"
          onClick={(e) => {
            e.stopPropagation();
            setMoving((v) => !v);
          }}
        >
          <FolderInput size={14} />
        </button>
        <button
          className="hidden shrink-0 rounded p-1 text-fg-subtle hover:bg-hover hover:text-danger group-hover:block"
          title="セッションを削除"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`「${title}」を削除する？`)) {
              send({ type: "close_session", sessionId: id });
            }
          }}
        >
          <X size={14} />
        </button>
      </div>
      {/* サイドバーは overflow-y-auto なので、浮かせると見切れる。行の下に開く */}
      {moving && (
        <div className="border-l-2 border-transparent bg-app/50 py-1 pl-6 pr-3">
          {groups.length === 0 && (
            <div className="py-1 text-[11px] text-fg-subtle">グループがまだありません</div>
          )}
          {groups.map((g) => (
            <button
              key={g.id}
              className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-hover ${
                session.meta.groupId === g.id ? "text-accent" : "text-fg-muted"
              }`}
              onClick={() => moveTo(g.id)}
            >
              {g.name}
            </button>
          ))}
          {session.meta.groupId && (
            <button
              className="block w-full rounded px-2 py-1 text-left text-xs text-fg-subtle hover:bg-hover"
              onClick={() => moveTo(undefined)}
            >
              グループから外す
            </button>
          )}
        </div>
      )}
    </>
  );
}

function GroupHeader({
  group,
  count,
  collapsed,
  onToggle,
}: {
  group: SessionGroup;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 px-2 pb-0.5 pt-2.5">
      <button
        className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-bold uppercase text-fg-subtle hover:text-fg-muted"
        onClick={onToggle}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="truncate">{group.name}</span>
        <span className="shrink-0 font-normal">{count}</span>
      </button>
      <button
        className="hidden shrink-0 rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-fg group-hover:block"
        title="グループ名を変更"
        onClick={() => {
          const name = prompt("グループ名", group.name)?.trim();
          if (name) send({ type: "rename_group", id: group.id, name });
        }}
      >
        <Pencil size={12} />
      </button>
      <button
        className="hidden shrink-0 rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-danger group-hover:block"
        title="グループを削除（中のセッションは残る）"
        onClick={() => {
          if (confirm(`グループ「${group.name}」を削除する？セッションは未分類に戻るよ`)) {
            send({ type: "delete_group", id: group.id });
          }
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ドロップ先の識別子。未分類は空文字で表す
const UNGROUPED = "";

export function Sidebar({ onClose }: { onClose: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const order = useChatStore((s) => s.order);
  const sessions = useChatStore((s) => s.sessions);
  const groups = useChatStore((s) => s.groups);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  // グループ枠へのドロップでセッションを移す。空文字なら未分類に戻す
  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move" as const;
      setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === target ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const sessionId = e.dataTransfer.getData("text/plain");
      if (sessionId) {
        send({ type: "set_session_group", sessionId, groupId: target || undefined });
      }
      setDropTarget(null);
      setDragging(false);
    },
    className: dropTarget === target ? "rounded-md bg-hover outline-1 outline-dashed outline-accent" : "",
  });

  const listed = order.flatMap((id) => (sessions[id] ? [{ id, session: sessions[id] }] : []));
  const inGroup = (groupId: string) => listed.filter((e) => e.session.meta.groupId === groupId);
  const ungrouped = listed.filter(
    (e) => !groups.some((g) => g.id === e.session.meta.groupId),
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 font-bold text-accent">
          <Spool size={16} />
          Clew
        </span>
        {/* 日本語フォントは字面の下に余白が残るため、ボックス中央だとアイコンが上に見える */}
        <div className="flex translate-y-[2px] items-center gap-0.5">
          <button
            className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
            title="設定"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={16} />
          </button>
          <button
            className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
            title={`サイドバーを閉じる (${modKeyLabel}+B)`}
            onClick={onClose}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>
      <button
        className="group mx-2 mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-fg-muted hover:border-accent hover:text-accent"
        onClick={() => setActive(null)}
      >
        <span className="flex items-center gap-1.5">
          <Plus size={14} />
          新規セッション
        </span>
        <span className="text-[11px] text-fg-subtle group-hover:text-accent">
          {modKeyLabel}+Shift+O
        </span>
      </button>
      <button
        className="mx-2 mb-2 mt-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-fg-subtle hover:bg-hover hover:text-fg-muted"
        onClick={() => {
          const name = prompt("グループ名")?.trim();
          if (name) send({ type: "create_group", name });
        }}
      >
        <FolderPlus size={12} />
        グループを作成
      </button>
      <div className="flex-1 overflow-y-auto pb-2">
        {groups.map((group) => {
          const entries = inGroup(group.id);
          const isCollapsed = collapsed.includes(group.id);
          const { className, ...handlers } = dropProps(group.id);
          return (
            <div key={group.id} className={className} {...handlers}>
              <GroupHeader
                group={group}
                count={entries.length}
                collapsed={isCollapsed}
                onToggle={() => toggleCollapsed(group.id)}
              />
              {/* 畳んでいてもドロップできるよう、空でも受け皿の高さを残す */}
              {!isCollapsed &&
                (entries.length === 0 ? (
                  <div className="px-3 py-1 text-[11px] text-fg-subtle">（空）</div>
                ) : (
                  entries.map((e) => (
                    <SessionRow
                      key={e.id}
                      id={e.id}
                      session={e.session}
                      onDragStart={() => setDragging(true)}
                      onDragEnd={() => {
                        setDragging(false);
                        setDropTarget(null);
                      }}
                    />
                  ))
                ))}
            </div>
          );
        })}
        {(() => {
          const { className, ...handlers } = dropProps(UNGROUPED);
          return (
            <div className={className} {...handlers}>
              {groups.length > 0 && (ungrouped.length > 0 || dragging) && (
                <div className="px-3 pb-0.5 pt-2.5 text-[11px] font-bold uppercase text-fg-subtle">
                  未分類
                </div>
              )}
              {ungrouped.map((e) => (
                <SessionRow
                  key={e.id}
                  id={e.id}
                  session={e.session}
                  onDragStart={() => setDragging(true)}
                  onDragEnd={() => {
                    setDragging(false);
                    setDropTarget(null);
                  }}
                />
              ))}
              {dragging && ungrouped.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-fg-subtle">ここにドロップで未分類へ</div>
              )}
            </div>
          );
        })()}
        {activeId === null && (
          <div className="flex items-center gap-2 border-l-2 border-accent bg-hover px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">新規セッション</div>
              <div className="truncate text-[11px] text-fg-subtle">未送信</div>
            </div>
          </div>
        )}
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </aside>
  );
}
