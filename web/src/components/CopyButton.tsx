import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "../markdown";

export function CopyButton({
  text,
  className,
  iconOnly,
  label = "コピー",
}: {
  // コードブロックのように、押した時点のDOMから本文を取りたい場合は関数で渡す
  text: string | (() => string);
  className?: string;
  // 本文の上に重ねる場所では隠す面積を減らしたいのでラベルを省く
  iconOnly?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      title={copied ? "コピーした" : "markdownとしてコピー"}
      onClick={async () => {
        if (!(await copyText(typeof text === "function" ? text() : text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {!iconOnly && (copied ? "コピーした" : label)}
    </button>
  );
}
