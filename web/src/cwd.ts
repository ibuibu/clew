import type { RepoEntry } from "./components/RepoPicker";

// worktreeは末尾だけだとブランチ用ディレクトリ名しか出ないので、親のリポジトリ名も添える
export function cwdLabel(path: string, repos: RepoEntry[]): string {
  const parts = path.split("/").filter(Boolean);
  const kind = repos.find((r) => r.path === path)?.kind;
  if (kind === "worktree") return parts.slice(-2).join("/");
  return parts.at(-1) ?? path;
}
