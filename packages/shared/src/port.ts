// server の bind と Vite の proxy 先は同じ値でなければならない。
// 別々にパースすると "3456x" のような値で片方だけ既定値に落ち、
// dev の画面が既定ポートで動く別インスタンスに繋がってしまう。
// Number() は "0x10" を 16 と読むので、10進数の見た目だけを受け付ける
export function resolvePort(name: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (value === undefined || value === "") return fallback;
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} must be a decimal integer between 1 and 65535, got ${JSON.stringify(raw)}`);
  }
  return n;
}
