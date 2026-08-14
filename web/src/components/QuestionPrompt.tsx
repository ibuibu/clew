import { useEffect, useState } from "react";
import type { QuestionInfo } from "@claude-web/shared";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";

function QuestionBlock({
  q,
  selected,
  freeText,
  onToggle,
  onFreeText,
}: {
  q: QuestionInfo;
  selected: string[];
  freeText: string;
  onToggle: (label: string) => void;
  onFreeText: (text: string) => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-fg-subtle">{q.header}</div>
      <div className="mb-2 text-sm font-medium">{q.question}</div>
      <div className="flex flex-col gap-1.5">
        {q.options.map((opt) => {
          const isSelected = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                isSelected
                  ? "border-accent bg-accent/15"
                  : "border-line bg-elevated hover:border-fg-subtle"
              }`}
              onClick={() => onToggle(opt.label)}
            >
              <span className="flex items-center gap-2">
                {q.multiSelect && (
                  <span className="text-xs">{isSelected ? "☑" : "☐"}</span>
                )}
                <span className={isSelected ? "font-bold text-accent" : ""}>{opt.label}</span>
              </span>
              {opt.description && <div className="mt-0.5 text-xs text-fg-subtle">{opt.description}</div>}
            </button>
          );
        })}
        <input
          className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm placeholder-fg-subtle"
          placeholder="その他（自由記述）"
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
        />
      </div>
    </div>
  );
}

export function QuestionModal() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const question = session?.question ?? null;
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});

  // 新しい質問が来たら選択状態をリセット
  useEffect(() => {
    setSelections({});
    setFreeTexts({});
  }, [question?.id]);

  if (!question || !activeId) return null;

  const answerFor = (q: QuestionInfo): string => {
    const free = (freeTexts[q.question] ?? "").trim();
    if (free) return free;
    return (selections[q.question] ?? []).join(", ");
  };

  const allAnswered = question.questions.every((q) => answerFor(q) !== "");

  const toggle = (q: QuestionInfo, label: string) => {
    setSelections((prev) => {
      const current = prev[q.question] ?? [];
      const next = q.multiSelect
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label];
      return { ...prev, [q.question]: next };
    });
  };

  const submit = () => {
    const answers: Record<string, string> = {};
    for (const q of question.questions) answers[q.question] = answerFor(q);
    send({ type: "question_response", sessionId: activeId, id: question.id, answers });
  };

  const skip = () => {
    send({ type: "question_response", sessionId: activeId, id: question.id });
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60">
      <div className="max-h-[85vh] w-[min(600px,92vw)] overflow-y-auto rounded-xl border border-line bg-panel p-5">
        <h3 className="mb-4 text-[15px] font-bold">❓ Claudeからの質問</h3>
        {question.questions.map((q) => (
          <QuestionBlock
            key={q.question}
            q={q}
            selected={selections[q.question] ?? []}
            freeText={freeTexts[q.question] ?? ""}
            onToggle={(label) => toggle(q, label)}
            onFreeText={(text) => setFreeTexts((prev) => ({ ...prev, [q.question]: text }))}
          />
        ))}
        <div className="mt-2 flex justify-end gap-2.5">
          <button
            className="rounded-lg bg-panel px-4 py-2 text-sm hover:bg-hover"
            onClick={skip}
          >
            スキップ
          </button>
          <button
            className="rounded-lg bg-accent px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
            disabled={!allAnswered}
            onClick={submit}
          >
            回答する
          </button>
        </div>
      </div>
    </div>
  );
}
