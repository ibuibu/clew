// 40.1k は残し 1.0M は 1M にする
const trimZero = (n: number) => n.toFixed(1).replace(/\.0$/, "");

export const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  if (n >= 1000) return `${trimZero(n / 1000)}k`;
  return String(n);
};
