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
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">{q.header}</div>
      <div className="mb-2 text-sm font-medium">{q.question}</div>
      <div className="flex flex-col gap-1.5">
        {q.options.map((opt) => {
          const isSelected = selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                isSelected
                  ? "border-orange-400 bg-orange-500/15"
                  : "border-zinc-600 bg-zinc-900 hover:border-zinc-400"
              }`}
              onClick={() => onToggle(opt.label)}
            >
              <span className="flex items-center gap-2">
                {q.multiSelect && (
                  <span className="text-xs">{isSelected ? "☑" : "☐"}</span>
                )}
                <span className={isSelected ? "font-bold text-orange-300" : ""}>{opt.label}</span>
              </span>
              {opt.description && <div className="mt-0.5 text-xs text-zinc-500">{opt.description}</div>}
            </button>
          );
        })}
        <input
          className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm placeholder-zinc-600"
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
      <div className="max-h-[85vh] w-[min(600px,92vw)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800 p-5">
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
            className="rounded-lg bg-zinc-600 px-4 py-2 text-sm hover:bg-zinc-500"
            onClick={skip}
          >
            スキップ
          </button>
          <button
            className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-bold text-white hover:bg-orange-400 disabled:opacity-40"
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
