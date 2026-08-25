import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RepoEntry = { path: string; name: string };

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
        });
      }
    }
  }

  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}
