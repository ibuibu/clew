import { CircleQuestionMark, Square, SquareCheck } from "lucide-react";
import { useState } from "react";
import type { QuestionInfo } from "@clew/shared";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";

function QuestionBlock({
  q,
  selected,
  freeText,
  onToggle,
  onFreeText,
  onSubmit,
}: {
  q: QuestionInfo;
  selected: string[];
  freeText: string;
  onToggle: (label: string) => void;
  onFreeText: (text: string) => void;
  onSubmit: () => void;
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
                {q.multiSelect &&
                  (isSelected ? (
                    <SquareCheck size={15} className="shrink-0 text-accent" />
                  ) : (
                    <Square size={15} className="shrink-0 text-fg-subtle" />
                  ))}
                <span className={isSelected ? "font-bold text-accent" : ""}>{opt.label}</span>
              </span>
              {opt.description && <div className="mt-0.5 text-xs text-fg-subtle">{opt.description}</div>}
            </button>
          );
        })}
        <input
          className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm"
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
          onKeyDown={(e) => {
            // IMEの変換確定のEnterは送信に使わない
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
    </div>
  );
}

export function QuestionPrompt() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const question = session?.question ?? null;
  // 質問idを含めたキーで持つことで、セッションを切り替えても入力が残る
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});

  if (!question || !activeId) return null;

  const keyOf = (q: QuestionInfo) => `${question.id}\n${q.question}`;

  const answerFor = (q: QuestionInfo): string => {
    const free = (freeTexts[keyOf(q)] ?? "").trim();
    if (free) return free;
    return (selections[keyOf(q)] ?? []).join(", ");
  };

  const allAnswered = question.questions.every((q) => answerFor(q) !== "");

  const toggle = (q: QuestionInfo, label: string) => {
    setSelections((prev) => {
      const current = prev[keyOf(q)] ?? [];
      const next = q.multiSelect
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label];
      return { ...prev, [keyOf(q)]: next };
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
    <div className="w-[95%] self-start rounded-xl border border-accent bg-elevated p-4">
      <h3 className="mb-4 flex items-center gap-1.5 text-[15px] font-bold">
        <CircleQuestionMark size={15} className="shrink-0" />
        Claudeからの質問
      </h3>
      {question.questions.map((q) => (
        <QuestionBlock
          key={q.question}
          q={q}
          selected={selections[keyOf(q)] ?? []}
          freeText={freeTexts[keyOf(q)] ?? ""}
          onToggle={(label) => toggle(q, label)}
          onFreeText={(text) => setFreeTexts((prev) => ({ ...prev, [keyOf(q)]: text }))}
          onSubmit={() => {
            if (allAnswered) submit();
          }}
        />
      ))}
      <div className="mt-2 flex justify-end gap-2.5">
        <button
          className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-hover"
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
  );
}
