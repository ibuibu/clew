import {
  ChevronRight,
  Circle,
  CircleAlert,
  FolderGit2,
  FolderPlus,
  GitBranch,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings,
  Spool,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import type { SessionGroup, SessionMeta } from "@clew/shared";
import { modKeyLabel } from "../platform";
import { cwdLabel } from "../cwd";
import { formatTokens } from "../format";
import { useChatStore, type SessionState } from "../store";
import { send } from "../ws";
import { SettingsDialog } from "./SettingsDialog";
import { TrashDialog } from "./TrashDialog";
import { TagChip } from "./Tags";

const COLLAPSED_KEY = "clew-collapsed-groups";
const TREE_COLLAPSED_KEY = "clew-collapsed-tree";
const VIEW_KEY = "clew-sidebar-view";

const loadCollapsed = (key: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

type SidebarView = "group" | "repo";
type Entry = { id: string; session: SessionState };

// その場で名前を編集する入力欄。Enterで確定、Escapeで取り消し
function InlineRename({
  value,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Escapeでの取り消し直後にもblurが走るので、確定させないための目印
  const cancelled = useRef(false);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    onCancel();
  };

  return (
    <input
      autoFocus
      className={`min-w-0 flex-1 rounded border border-accent bg-elevated px-1 outline-none ${className ?? ""}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        if (cancelled.current) return;
        commit();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          cancelled.current = true;
          onCancel();
        }
      }}
    />
  );
}

// リポジトリ表示では並び替えを扱わないので、ドラッグ関連は任意にしてある
function SessionRow({
  id,
  session,
  indent = 0,
  showCwd = true,
  dropIndicator = false,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDropRow,
}: {
  id: string;
  session: SessionState;
  indent?: number;
  showCwd?: boolean;
  dropIndicator?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOverRow?: () => void;
  onDropRow?: (draggedId: string) => void;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const needsAction = session.permission || session.question;
  const title = session.meta.title || "（無題）";

  return (
    <>
      <div
        className={`group flex cursor-pointer items-center gap-2 border-l-2 px-3 ${
          showCwd ? "py-2" : "py-1"
        } ${
          id === activeId ? "border-accent bg-hover" : "border-transparent hover:bg-hover"
        } ${dropIndicator ? "shadow-[inset_0_2px_0_0_var(--color-accent)]" : ""}`}
        style={indent ? { paddingLeft: 12 + indent } : undefined}
        draggable={!renaming && onDragStart !== undefined}
        onDragStart={(e) => {
          if (!onDragStart) return;
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!onDragOverRow) return;
          // 行に重ねたときはグループ枠ではなく並び替えとして扱う
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          onDragOverRow();
        }}
        onDrop={(e) => {
          if (!onDropRow) return;
          e.preventDefault();
          e.stopPropagation();
          const draggedId = e.dataTransfer.getData("text/plain");
          if (draggedId) onDropRow(draggedId);
        }}
        onMouseLeave={() => setConfirming(false)}
        onClick={() => setActive(id)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[13px]">
            {needsAction && <CircleAlert size={13} className="shrink-0 text-danger" />}
            {/* 実行中は塗りつぶして明滅、待機中は輪郭だけ。位置がずれないよう常に出す */}
            <Circle
              size={8}
              fill={session.isRunning ? "currentColor" : "none"}
              className={`shrink-0 ${
                session.isRunning ? "animate-pulse text-accent" : "text-fg-subtle"
              }`}
            />
            {renaming ? (
              <InlineRename
                value={session.meta.title}
                className="text-[13px]"
                onCommit={(next) => send({ type: "rename_session", sessionId: id, title: next })}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <span className="truncate">{title}</span>
            )}
          </div>
          {showCwd && (
            <div className="truncate text-[11px] text-fg-subtle">
              {[cwdLabel(session.meta.cwd), subtitle(session.meta)].filter(Boolean).join(" · ")}
            </div>
          )}
          {session.meta.tags && session.meta.tags.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
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
            setRenaming(true);
          }}
        >
          <Pencil size={14} />
        </button>
        {confirming ? (
          <button
            className="shrink-0 rounded bg-danger px-2 py-0.5 text-[11px] font-bold text-app hover:opacity-90"
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "close_session", sessionId: id });
            }}
          >
            削除
          </button>
        ) : (
          <button
            className="hidden shrink-0 rounded p-1 text-fg-subtle hover:bg-hover hover:text-danger group-hover:block"
            title="セッションをゴミ箱に入れる"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
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
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      className="group flex items-center gap-1 px-2 pb-0.5 pt-2.5"
      onMouseLeave={() => setConfirming(false)}
    >
      {renaming ? (
        <InlineRename
          value={group.name}
          className="text-[11px]"
          onCommit={(name) => send({ type: "rename_group", id: group.id, name })}
          onCancel={() => setRenaming(false)}
        />
      ) : (
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
      )}
      <button
        className="hidden shrink-0 rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-fg group-hover:block"
        title="グループ名を変更"
        onClick={() => setRenaming(true)}
      >
        <Pencil size={12} />
      </button>
      {confirming ? (
        <button
          className="shrink-0 rounded bg-danger px-2 py-0.5 text-[10px] font-bold text-app hover:opacity-90"
          title="セッションは未分類に戻る"
          onClick={() => send({ type: "delete_group", id: group.id })}
        >
          削除
        </button>
      ) : (
        <button
          className="hidden shrink-0 rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-danger group-hover:block"
          title="グループを削除（中のセッションは残る）"
          onClick={() => setConfirming(true)}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

type BranchNode = { key: string; branch: string | null; worktree: boolean; entries: Entry[] };
type RepoNode = {
  repo: string;
  branches: BranchNode[];
  count: number;
  running: boolean;
  needsAction: boolean;
};

// worktreeは本体と別ディレクトリなので、cwdではなく解決済みのrepo/branchでまとめる
function buildRepoTree(listed: Entry[]): RepoNode[] {
  const repos = new Map<string, Map<string, BranchNode>>();
  for (const e of listed) {
    const repo = e.session.meta.repo || cwdLabel(e.session.meta.cwd);
    const branch = e.session.meta.branch ?? null;
    let branches = repos.get(repo);
    if (!branches) {
      branches = new Map();
      repos.set(repo, branches);
    }
    const key = branch ?? "";
    const node = branches.get(key) ?? {
      key,
      branch,
      worktree: e.session.meta.worktree ?? false,
      entries: [],
    };
    node.entries.push(e);
    branches.set(key, node);
  }

  return [...repos]
    .map(([repo, branches]) => {
      // 本体のブランチを先に、worktreeを後ろに並べる
      const list = [...branches.values()].sort(
        (a, b) => Number(a.worktree) - Number(b.worktree) || a.key.localeCompare(b.key),
      );
      const entries = list.flatMap((b) => b.entries);
      return {
        repo,
        branches: list,
        count: entries.length,
        running: entries.some((e) => e.session.isRunning),
        needsAction: entries.some((e) => e.session.permission || e.session.question),
      };
    })
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

function RepoTree({ listed }: { listed: Entry[] }) {
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed(TREE_COLLAPSED_KEY));

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key];
      localStorage.setItem(TREE_COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });

  const tree = buildRepoTree(listed);
  if (tree.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-fg-subtle">セッションがありません</div>;
  }

  return (
    <>
      {tree.map((node) => {
        const repoKey = `repo:${node.repo}`;
        const repoOpen = !collapsed.includes(repoKey);
        return (
          <div key={node.repo}>
            <button
              className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-bold text-fg-subtle hover:text-fg-muted"
              onClick={() => toggle(repoKey)}
            >
              <ChevronRight
                size={12}
                className={`shrink-0 transition-transform ${repoOpen ? "rotate-90" : ""}`}
              />
              <FolderGit2 size={12} className="shrink-0" />
              <span className="truncate">{node.repo}</span>
              {node.needsAction && <CircleAlert size={11} className="shrink-0 text-danger" />}
              {node.running && (
                <Circle
                  size={7}
                  fill="currentColor"
                  className="shrink-0 animate-pulse text-accent"
                />
              )}
              <span className="ml-auto shrink-0 font-normal">{node.count}</span>
            </button>
            {repoOpen &&
              node.branches.map((b) =>
                // git管理外はブランチの行を作らず、リポジトリ直下に並べる
                b.branch === null ? (
                  b.entries.map((e) => (
                    <SessionRow key={e.id} id={e.id} session={e.session} indent={14} showCwd={false} />
                  ))
                ) : (
                  <BranchGroup
                    key={b.key}
                    node={b}
                    collapsed={collapsed.includes(`branch:${node.repo}\n${b.key}`)}
                    onToggle={() => toggle(`branch:${node.repo}\n${b.key}`)}
                  />
                ),
              )}
          </div>
        );
      })}
    </>
  );
}

function BranchGroup({
  node,
  collapsed,
  onToggle,
}: {
  node: BranchNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        className="flex w-full items-center gap-1 py-0.5 pr-2 text-[11px] text-fg-subtle hover:text-fg-muted"
        style={{ paddingLeft: 18 }}
        title={node.worktree ? "worktree" : undefined}
        onClick={onToggle}
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        {node.worktree && <GitBranch size={11} className="shrink-0 text-accent" />}
        <span className="truncate font-mono">{node.branch}</span>
        <span className="ml-auto shrink-0">{node.entries.length}</span>
      </button>
      {!collapsed &&
        node.entries.map((e) => (
          <SessionRow key={e.id} id={e.id} session={e.session} indent={28} showCwd={false} />
        ))}
    </div>
  );
}

// ドロップ先の識別子。未分類は空文字で表す
const UNGROUPED = "";

export function Sidebar({
  onClose,
  onSearch,
  width,
  onResizeStart,
}: {
  onClose: () => void;
  onSearch: () => void;
  width: number;
  onResizeStart: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [view, setView] = useState<SidebarView>(
    () => (localStorage.getItem(VIEW_KEY) === "repo" ? "repo" : "group"),
  );
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed(COLLAPSED_KEY));
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // 並び替えで、どの行の手前に入るかを示す
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const order = useChatStore((s) => s.order);
  const sessions = useChatStore((s) => s.sessions);
  const groups = useChatStore((s) => s.groups);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const trash = useChatStore((s) => s.trash);

  const selectView = (next: SidebarView) => {
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const endDrag = () => {
    setDragging(false);
    setDropTarget(null);
    setDropBefore(null);
  };

  const reorder = (draggedId: string, beforeSessionId: string) => {
    if (draggedId !== beforeSessionId) {
      send({ type: "reorder_session", sessionId: draggedId, beforeSessionId });
    }
    endDrag();
  };

  // グループ枠へのドロップでセッションを移す。空文字なら未分類に戻す
  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move" as const;
      setDropTarget(target);
      setDropBefore(null);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === target ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const sessionId = e.dataTransfer.getData("text/plain");
      if (sessionId) {
        send({ type: "set_session_group", sessionId, groupId: target || undefined });
      }
      endDrag();
    },
    className: dropTarget === target ? "rounded-md bg-hover outline-1 outline-dashed outline-accent" : "",
  });

  const listed = order.flatMap((id) => (sessions[id] ? [{ id, session: sessions[id] }] : []));
  const inGroup = (groupId: string) => listed.filter((e) => e.session.meta.groupId === groupId);
  const ungrouped = listed.filter(
    (e) => !groups.some((g) => g.id === e.session.meta.groupId),
  );

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-line bg-panel"
      style={{ width }}
    >
      {/* 右端の掴みしろ。線そのものは細いので、当たり判定だけ広げる */}
      <div
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
        title="ドラッグで幅を変える"
        onMouseDown={(e) => {
          e.preventDefault();
          onResizeStart();
        }}
      />
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 font-bold text-accent">
          <Spool size={16} />
          Clew
        </span>
        {/* 日本語フォントは字面の下に余白が残るため、ボックス中央だとアイコンが上に見える */}
        <div className="flex translate-y-[2px] items-center gap-0.5">
          <button
            className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
            title={`検索 (${modKeyLabel}+K)`}
            onClick={onSearch}
          >
            <Search size={16} />
          </button>
          <button
            className="relative rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
            title={trash.length > 0 ? `ゴミ箱 (${trash.length})` : "ゴミ箱"}
            onClick={() => setTrashOpen(true)}
          >
            <Trash2 size={16} />
            {trash.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[9px] font-bold leading-[13px] text-app">
                {trash.length}
              </span>
            )}
          </button>
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
      <div className="mx-2 mt-2 flex gap-0.5 rounded-lg bg-hover p-0.5 text-[11px]">
        {([
          ["group", "グループ"],
          ["repo", "リポジトリ"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`flex-1 rounded-md py-1 ${
              view === key ? "bg-elevated font-bold text-fg" : "text-fg-subtle hover:text-fg-muted"
            }`}
            onClick={() => selectView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "repo" ? null : creatingGroup ? (
        <div className="mx-2 mb-2 mt-1 flex px-3 py-1">
          <InlineRename
            value=""
            className="text-[11px]"
            onCommit={(name) => send({ type: "create_group", name })}
            onCancel={() => setCreatingGroup(false)}
          />
        </div>
      ) : (
        <button
          className="mx-2 mb-2 mt-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-fg-subtle hover:bg-hover hover:text-fg-muted"
          onClick={() => setCreatingGroup(true)}
        >
          <FolderPlus size={12} />
          グループを作成
        </button>
      )}
      <div className="flex-1 overflow-y-auto pb-2">
        {view === "repo" && <RepoTree listed={listed} />}
        {view === "group" &&
          groups.map((group) => {
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
                        dropIndicator={dropBefore === e.id}
                        onDragStart={() => setDragging(true)}
                        onDragEnd={endDrag}
                        onDragOverRow={() => {
                          setDropBefore(e.id);
                          setDropTarget(null);
                        }}
                        onDropRow={(draggedId) => reorder(draggedId, e.id)}
                      />
                    ))
                  ))}
              </div>
            );
          })}
        {view === "group" &&
          (() => {
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
                    dropIndicator={dropBefore === e.id}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={endDrag}
                    onDragOverRow={() => {
                      setDropBefore(e.id);
                      setDropTarget(null);
                    }}
                    onDropRow={(draggedId) => reorder(draggedId, e.id)}
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
      <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} />
    </aside>
  );
}

// Codexだけはどのエージェントか分かるように名前も添える
function subtitle(meta: SessionMeta): string {
  const tokens = meta.tokens ? `${formatTokens(meta.tokens.input + meta.tokens.output)} tok` : "";
  if (meta.agent !== "codex") return tokens;
  return tokens ? `Codex · ${tokens}` : "Codex";
}
