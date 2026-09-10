import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RepoEntry = { path: string; name: string };

// ghq root（root/host/owner/repo の3階層）配下のリポジトリを辞書順で返す
export async function listGhqRepos(): Promise<RepoEntry[]> {
  const root = process.env.GHQ_ROOT || path.join(os.homedir(), "ghq");
  const repos: RepoEntry[] = [];

  // readdirのDirentはリンク自体を見るのでシンボリックリンクは isDirectory() が false になる。
  // ghq配下を別ドライブへリンクしている場合も拾えるよう、リンクは辿ってから確かめる
  const isDir = async (p: string, entry: Dirent) => {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;
    return fs.stat(p).then(
      (stat) => stat.isDirectory(),
      () => false,
    );
  };

  const dirents = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const visible = entries.filter((e) => !e.name.startsWith("."));
    const flags = await Promise.all(visible.map((e) => isDir(path.join(dir, e.name), e)));
    return visible.filter((_, i) => flags[i]);
  };

  for (const host of await dirents(root)) {
    const hostPath = path.join(root, host.name);
    for (const owner of await dirents(hostPath)) {
      const ownerPath = path.join(hostPath, owner.name);
      for (const repo of await dirents(ownerPath)) {
        repos.push({
          path: path.join(ownerPath, repo.name),
          name: `${owner.name}/${repo.name}`,
        });
      }
    }
  }

  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}
