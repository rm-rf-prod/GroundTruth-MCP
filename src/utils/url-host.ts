/** True when `url` parses and its hostname is `host` or a subdomain of it. */
export function isHostOrSubdomain(url: string, host: string): boolean {
  // Repository fields often omit the scheme (`github.com/o/r`) or use scp form (`git@github.com:o/r.git`).
  const full = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url.replace(/^[^@/\s]+@([^:/\s]+):/, "$1/")}`;
  if (!URL.canParse(full)) return false;
  const h = new URL(full).hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}
