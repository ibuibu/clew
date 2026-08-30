import { spawn } from "node:child_process";

const TIMEOUT_MS = 120_000;
// 長い出力でDBとコンテキストが膨らむのを防ぐ
const MAX_OUTPUT = 20_000;

export type BashResult = { output: string; exitCode: number | null };

// 入力欄のbashモード用。stdoutとstderrは区別せず、ターミナルで見たままの順に並べる
export function runBash(command: string, cwd: string): Promise<BashResult> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let length = 0;
    let truncated = false;
    let settled = false;

    const child = spawn(command, { cwd, shell: "/bin/bash" });

    const collect = (data: Buffer) => {
      if (truncated) return;
      const text = data.toString();
      if (length + text.length > MAX_OUTPUT) {
        chunks.push(text.slice(0, MAX_OUTPUT - length), "\n… (出力が長いため以降を省略)");
        truncated = true;
        return;
      }
      chunks.push(text);
      length += text.length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => {
      chunks.push(`\n… (${TIMEOUT_MS / 1000}秒を超えたため中断)`);
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    // errorのあとにcloseも来ることがあるので、先に解決した方だけを使う
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output: chunks.join(""), exitCode });
    };
    child.on("error", (err) => {
      chunks.push(err.message);
      finish(null);
    });
    child.on("close", finish);
  });
}
