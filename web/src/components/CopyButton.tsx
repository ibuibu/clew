import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "../markdown";

export function CopyButton({
  text,
  className,
  iconOnly,
}: {
  text: string;
  className?: string;
  // 本文の上に重ねる場所では隠す面積を減らしたいのでラベルを省く
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      title={copied ? "コピーした" : "markdownとしてコピー"}
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {!iconOnly && (copied ? "コピーした" : "コピー")}
    </button>
  );
}
