import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "../markdown";

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      title="markdownとしてコピー"
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "コピーした" : "コピー"}
    </button>
  );
}
