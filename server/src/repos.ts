import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RepoEntry = { path: string; name: string; kind: "repo" | "worktree" };

// ghq root（root/host/owner/repo の3階層）配下のリポジトリを辞書順で返す
export async function listGhqRepos(): Promise<RepoEntry[]> {
  const root = process.env.GHQ_ROOT || path.join(os.homedir(), "ghq");
  const repos: RepoEntry[] = [];

  const dirents = (p: string) =>
    fs.readdir(p, { withFileTypes: true }).then(
      (entries) => entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")),
      () => [],
    );

  for (const host of await dirents(root)) {
    const hostPath = path.join(root, host.name);
    for (const owner of await dirents(hostPath)) {
      const ownerPath = path.join(hostPath, owner.name);
      for (const repo of await dirents(ownerPath)) {
        repos.push({
          path: path.join(ownerPath, repo.name),
          name: `${owner.name}/${repo.name}`,
          kind: "repo",
        });
      }
    }
  }

  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}

type GwqWorktree = { path: string; branch: string; is_main: boolean };

// gwq管理のworktreeを辞書順で返す。gwqが無い環境では空リストになる
export async function listWorktrees(): Promise<RepoEntry[]> {
  const stdout = await execFileAsync("gwq", ["list", "-g", "--json"]).then(
    (r) => r.stdout,
    () => "",
  );
  if (!stdout.trim()) return [];

  let list: GwqWorktree[];
  try {
    list = JSON.parse(stdout);
  } catch {
    return [];
  }

  const worktrees = list
    // is_main はworktreeではなくリポジトリ本体なので、ghq一覧と重複する
    .filter((w) => !w.is_main)
    .map((w) => {
      const repoDir = path.dirname(w.path);
      const owner = path.basename(path.dirname(repoDir));
      return {
        path: w.path,
        name: `${owner}/${path.basename(repoDir)} (${w.branch})`,
        kind: "worktree" as const,
      };
    });

  worktrees.sort((a, b) => a.name.localeCompare(b.name));
  return worktrees;
}
