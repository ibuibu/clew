import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type RepoInfo = {
  // ghq配下なら owner/repo、それ以外はディレクトリ名
  repo: string;
  // detached HEADや git 外では null
  branch: string | null;
  worktree: boolean;
};

// ターンごとに引き直すので、連続した呼び出しだけまとめる
const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; info: RepoInfo | null }>();

const git = (cwd: string, args: string[]) =>
  new Promise<string | null>((resolve) => {
    execFile("git", ["-C", cwd, ...args], (err, stdout) => resolve(err ? null : stdout.trim()));
  });

// ghqのルート配下は host/owner/repo なので owner/repo まで残す
function ghqName(dir: string): string | null {
  const ghqRoot = process.env.GHQ_ROOT || path.join(os.homedir(), "ghq");
  const parts = path.relative(ghqRoot, dir).split(path.sep);
  return parts.length === 3 && parts[0] !== ".." ? `${parts[1]}/${parts[2]}` : null;
}

async function resolve(cwd: string): Promise<RepoInfo | null> {
  const dirs = await git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  ]);
  const [toplevel, gitDir, commonDir] = (dirs ?? "").split("\n");
  if (!toplevel || !gitDir || !commonDir) return null;
  // 本体のworktreeでは --git-dir と --git-common-dir が同じになる
  const worktree = path.resolve(gitDir) !== path.resolve(commonDir);
  // worktree list は本体のworktreeを最初に出す。--git-common-dir の親から求めると
  // git init --separate-git-dir のリポジトリでgitディレクトリ側を指してしまう
  const root = worktree
    ? /^worktree (.+)$/m.exec((await git(cwd, ["worktree", "list", "--porcelain"])) ?? "")?.[1]
    : toplevel;
  if (!root) return null;
  const branch = await git(cwd, ["branch", "--show-current"]);
  return {
    // シンボリックリンク経由だとgitは実体のパスを返すので、まず渡されたcwdから名前を採る
    repo: ghqName(cwd) ?? ghqName(root) ?? path.basename(root),
    branch: branch || null,
    worktree,
  };
}

export async function readRepoInfo(cwd: string): Promise<RepoInfo | null> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;
  const info = await resolve(cwd);
  cache.set(cwd, { at: Date.now(), info });
  return info;
}
