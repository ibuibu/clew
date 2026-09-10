import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentKind, CodexMode, ModelChoice, PermissionMode, SessionMode } from "@clew/shared";
import { agentRef, effortRef, modelRef, permModeRef } from "../draft";
import { AGENT_LABEL } from "../format";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";

const CLAUDE_PERM_LABEL: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "accept edits",
  plan: "plan",
  auto: "auto",
  dontAsk: "don't ask",
  bypassPermissions: "bypass permissions",
};

// Codexの承認は approvalPolicy と sandbox の組で決まるので、その組に名前を付けて並べる
const CODEX_PERM_LABEL: Record<CodexMode, string> = {
  plan: "plan",
  readOnly: "read only",
  untrusted: "untrusted",
  onRequest: "on request",
  auto: "auto",
  never: "never ask",
  fullAccess: "full access",
};

const PERM_LABELS: Record<AgentKind, Record<string, string>> = {
  claude: CLAUDE_PERM_LABEL,
  codex: CODEX_PERM_LABEL,
};

const DEFAULT_MODE: Record<AgentKind, SessionMode> = { claude: "auto", codex: "auto" };

const chipClass = (selected: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-xs ${
    selected ? "border-accent text-accent" : "border-line text-fg-muted hover:border-fg-subtle"
  }`;

const rowClass = (selected: boolean) =>
  `w-full rounded-md border px-2.5 py-1.5 text-left ${
    selected ? "border-accent" : "border-line hover:border-fg-subtle"
  }`;

// エージェント・権限・モデル・effortをまとめて選ぶ。入力欄の上に並べると横幅が足りない
export function SessionSettings() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [draftAgent, setDraftAgent] = useState(agentRef.current);
  const [draftPermMode, setDraftPermMode] = useState(permModeRef.current);
  const [draftModel, setDraftModel] = useState(modelRef.current);
  const [draftEffort, setDraftEffort] = useState(effortRef.current);
  const ref = useRef<HTMLDialogElement>(null);

  const agent = session?.meta.agent ?? draftAgent;

  // showModal() でないと Esc とバックドロップが有効にならないので、open属性ではなくAPIで開閉する
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // モデル一覧はエージェント本体から取得する（Claudeは supportedModels、Codexは model/list）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/models?agent=${agent}`)
      .then((r) => r.json())
      .then((list: ModelChoice[]) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent]);

  const permLabels = PERM_LABELS[agent];
  // エージェントを切り替えた直後は、前のエージェントのモードが残っていることがある
  const permValue = activeId
    ? (session?.meta.permissionMode ?? DEFAULT_MODE[agent])
    : draftPermMode in permLabels
      ? draftPermMode
      : DEFAULT_MODE[agent];

  // 空文字 = モデル未指定（エージェント側の設定に従う）。SDKの "default" 行と重複するので除外する
  const modelValue = activeId ? (session?.meta.modelPref ?? "") : draftModel;
  const defaultRow = models.find((m) => m.value === "default");
  const defaultAlias = defaultRow?.resolvedModel
    ? models.find((m) => m.value !== "default" && m.resolvedModel === defaultRow.resolvedModel)
    : undefined;
  const defaultName = defaultAlias?.displayName ?? defaultRow?.resolvedModel;
  const modelOptions: ModelChoice[] = [
    { value: "", displayName: defaultName ? `デフォルト（${defaultName}）` : "デフォルト" },
    ...models.filter((m) => m.value !== "default"),
  ];
  if (modelValue && !modelOptions.some((m) => m.value === modelValue)) {
    modelOptions.push({ value: modelValue, displayName: modelValue });
  }

  // モデル未指定のときはデフォルトが解決される先のeffortを見る
  const selectedModel = modelValue
    ? models.find((m) => m.value === modelValue)
    : (defaultAlias ?? defaultRow);
  const efforts = selectedModel?.efforts ?? [];
  const effortValue = activeId ? (session?.meta.effort ?? "") : draftEffort;
  const defaultEffort = selectedModel?.defaultEffort;

  const selectPermMode = (mode: SessionMode) => {
    if (activeId) {
      send({ type: "set_permission_mode", sessionId: activeId, mode });
    } else {
      permModeRef.current = mode;
      setDraftPermMode(mode);
      localStorage.setItem("clew-perm", mode);
    }
  };

  const selectModel = (value: string) => {
    if (activeId) {
      send({ type: "set_model", sessionId: activeId, model: value || undefined });
    } else {
      modelRef.current = value;
      setDraftModel(value);
      localStorage.setItem("clew-model", value);
    }
  };

  const selectEffort = (value: string) => {
    if (activeId) {
      send({ type: "set_effort", sessionId: activeId, effort: value || undefined });
    } else {
      effortRef.current = value;
      setDraftEffort(value);
      localStorage.setItem("clew-effort", value);
    }
  };

  const selectAgent = (next: AgentKind) => {
    agentRef.current = next;
    setDraftAgent(next);
    localStorage.setItem("clew-agent", next);
    // モードとモデルの選択肢がエージェントごとに違うので既定に戻す
    selectPermMode(DEFAULT_MODE[next]);
    selectModel("");
    selectEffort("");
  };

  const modelLabel = modelOptions.find((m) => m.value === modelValue)?.displayName ?? "デフォルト";
  const summary = [AGENT_LABEL[agent], permLabels[permValue] ?? permValue, modelLabel, effortValue]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <button
        className="flex h-6 min-w-24 max-w-56 shrink items-center gap-1 rounded-full border border-line bg-elevated px-2 text-xs hover:border-fg-subtle"
        title="エージェント・権限・モデルを選ぶ"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={12} className="shrink-0" />
        <span className="truncate">{summary}</span>
        <ChevronDown size={11} className="ml-auto shrink-0" />
      </button>

      <dialog
        ref={ref}
        className="m-auto w-96 rounded-xl border border-line bg-elevated p-0 text-fg backdrop:bg-black/40"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-bold">セッションの設定</h2>
          <button
            className="rounded p-1 text-fg-subtle hover:bg-hover"
            title="閉じる"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-4 py-4">
          <section>
            <div className="mb-2 text-sm font-bold">エージェント</div>
            {activeId ? (
              <p className="text-xs text-fg-subtle">
                {AGENT_LABEL[agent]}（作成後は変更できません）
              </p>
            ) : (
              <div className="flex gap-1.5">
                {(Object.keys(AGENT_LABEL) as AgentKind[]).map((kind) => (
                  <button
                    key={kind}
                    className={chipClass(agent === kind)}
                    onClick={() => selectAgent(kind)}
                  >
                    {AGENT_LABEL[kind]}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 text-sm font-bold">権限モード</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(permLabels).map((mode) => (
                <button
                  key={mode}
                  className={chipClass(permValue === mode)}
                  onClick={() => selectPermMode(mode as SessionMode)}
                >
                  {permLabels[mode]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-sm font-bold">モデル</div>
            <div className="flex flex-col gap-1">
              {modelOptions.map((m) => (
                <button
                  key={m.value}
                  className={rowClass(modelValue === m.value)}
                  onClick={() => selectModel(m.value)}
                >
                  <div className={`text-xs ${modelValue === m.value ? "text-accent" : ""}`}>
                    {m.displayName}
                  </div>
                  {m.description && (
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{m.description}</div>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* effortに対応していないモデルでは選択肢が空になるので出さない */}
          {efforts.length > 0 && (
            <section>
              <div className="mb-2 text-sm font-bold">effort</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={chipClass(effortValue === "")}
                  title="モデルの既定に従う"
                  onClick={() => selectEffort("")}
                >
                  {defaultEffort ? `既定（${defaultEffort}）` : "既定"}
                </button>
                {efforts.map((e) => (
                  <button
                    key={e.value}
                    className={chipClass(effortValue === e.value)}
                    title={e.description}
                    onClick={() => selectEffort(e.value)}
                  >
                    {e.value}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </dialog>
    </>
  );
}
