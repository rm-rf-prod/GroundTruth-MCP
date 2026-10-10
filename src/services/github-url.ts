export function isGitHubHost(url: string): boolean {
  try {
    return new URL(url).hostname === "github.com";
  } catch {
    return false;
  }
}

/**
 * True when a repo-relative path holds a `.` or `..` segment, raw or
 * percent-encoded (any depth, `%2F` and `\` as separators too), or cannot be
 * decoded. Appended to /repos/{repo}/contents/, such a segment climbs onto any
 * api.github.com endpoint.
 */
export function hasDotSegment(path: string): boolean {
  let decoded = path;
  for (let prev = ""; decoded !== prev;) {
    prev = decoded;
    try { decoded = decodeURIComponent(decoded); } catch { return true; }
  }
  return decoded.split(/[/\\]/).some((s) => s === "." || s === "..");
}

/**
 * The repo file a github.com docs URL names: README.md for the repo, branch
 * (`/tree/`) or wiki page, the file for a `/blob/{ref}/{path}` URL, null for
 * every other page. Read from the parsed pathname, so `..` and `%2e%2e` are
 * already resolved and cannot reach outside the repo.
 */
export function gitHubDocFile(url: string): { repoUrl: string; path: string } | null {
  if (!isGitHubHost(url)) return null;
  const [owner, repo, kind, ref, ...rest] = new URL(url).pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  if (kind === undefined || kind === "tree" || kind === "wiki") return { repoUrl, path: "README.md" };
  if (kind === "blob" && ref && rest.length > 0) return { repoUrl, path: rest.join("/") };
  return null;
}
