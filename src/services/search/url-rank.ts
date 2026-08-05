/**
 * Ranking and extraction helpers for freeform web search results: which hosts
 * count as authoritative, how raw engine HTML is mined for candidate URLs, and
 * how those candidates are scored for documentation relevance.
 */
const AUTHORITATIVE_DOMAINS =
  "developer.mozilla.org|web.dev|owasp.org|cheatsheetseries.owasp.org|w3.org|webkit.org|whatwg.org|tc39.es|v8.dev|nodejs.org|docs.github.com|webaim.org|www.typescriptlang.org|vitest.dev|playwright.dev|jestjs.io|docs.astro.build|svelte.dev|vuejs.org|reactnative.dev|react.dev|nextjs.org|tailwindcss.com|orm.drizzle.team|supabase.com|vercel.com|docs.nestjs.com|fastapi.tiangolo.com|docs.python.org|doc.rust-lang.org|go.dev|kotlinlang.org|docs.flutter.dev|angular.dev|tanstack.com|hono.dev|elysiajs.com|zod.dev|prisma.io|stripe.com|clerk.com|authjs.dev|docs.expo.dev|firebase.google.com|ai.google.dev|platform.openai.com|docs.anthropic.com|sdk.vercel.ai|docs.deno.com|bun.sh|docs.sentry.io|turbo.build|biomejs.dev|docs.docker.com|kubernetes.io|docs.github.com|vite.dev|redis.io|www.postgresql.org|www.mongodb.com|developer.chrome.com|schema.org|developers.google.com|css-tricks.com|smashingmagazine.com|www.w3schools.com|learn.microsoft.com|docs.aws.amazon.com|cloud.google.com|docs.cloudflare.com|graphql.org|grpc.io|opentelemetry.io|www.elastic.co|helm.sh|prometheus.io|grafana.com|llmstxt.org|docs.pydantic.dev|docs.rs|crates.io|pkg.go.dev|hex.pm|hexdocs.pm|pub.dev|pypi.org|rubygems.org|packagist.org|nuget.org|mvnrepository.com|expressjs.com|fastify.dev|elixir-lang.org|www.rust-lang.org|kotlinlang.org|www.scala-lang.org|typst.app|daisyui.com|ui.shadcn.com|headlessui.com|mantine.dev|ant.design|mui.com|chakra-ui.com|www.radix-ui.com|ariakit.org";

const AUTHORITATIVE_URL_PATTERN = new RegExp(
  `https?:\\/\\/(?:${AUTHORITATIVE_DOMAINS})[^"<\\s]*`,
  "g",
);

/** Extract URLs from HTML anchor href attributes (standard search result format) */
export function extractHrefUrls(html: string): string[] {
  const urls: string[] = [];
  const hrefRe = /href="(https?:\/\/[^"]+)"/g;
  let match;
  while ((match = hrefRe.exec(html)) !== null && urls.length < 8) {
    const url = match[1]?.replace(/&amp;/g, "&");
    if (!url) continue;
    try {
      const hostname = new URL(url).hostname;
      if (
        hostname.includes("google.") ||
        hostname.includes("bing.") ||
        hostname.includes("duckduckgo.") ||
        hostname.includes("yahoo.") ||
        hostname.includes("yandex.") ||
        hostname === "r.search.yahoo.com"
      ) continue;
      if (
        /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm)$/i.test(url) ||
        /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(url)
      ) continue;
      if (!urls.includes(url)) urls.push(url);
    } catch { /* invalid URL */ }
  }
  return urls;
}

export function extractUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  let match;

  // Module-scoped /g regex: an early exit at the 5-URL cap leaves lastIndex
  // mid-string, silently corrupting the NEXT call's scan. Always start at 0.
  AUTHORITATIVE_URL_PATTERN.lastIndex = 0;

  // First pass: authoritative domains (highest priority)
  while ((match = AUTHORITATIVE_URL_PATTERN.exec(html)) !== null && urls.length < 5) {
    const url = match[0]?.replace(/['">\s].*$/, "");
    if (url && !urls.includes(url)) urls.push(url);
  }

  // Second pass: any documentation-looking href from search results
  if (urls.length < 3) {
    const hrefUrls = extractHrefUrls(html);
    for (const url of hrefUrls) {
      if (urls.length >= 5) break;
      if (!urls.includes(url)) {
        // Prioritize URLs that look like documentation
        if (/\/docs?\/|\/guide|\/api\/|\/reference|\/learn|\/tutorial|\/getting-started/i.test(url)) {
          urls.push(url);
        }
      }
    }
    // If still not enough, add any remaining hrefs
    for (const url of hrefUrls) {
      if (urls.length >= 5) break;
      if (!urls.includes(url)) urls.push(url);
    }
  }

  return urls;
}
/**
 * Extract real URLs from DuckDuckGo redirect wrappers.
 * DDG wraps all result links through //duckduckgo.com/l/?uddg=ENCODED_URL
 * The uddg= parameter contains the actual destination URL.
 * This pattern has been stable for 4+ years and is more reliable than HTML class scraping.
 */
export function extractDDGUrls(html: string): string[] {
  const urls: string[] = [];
  const uddgPattern = /uddg=(https?[^&"]+)/g;
  for (const match of html.matchAll(uddgPattern)) {
    if (urls.length >= 8) break;
    try {
      const url = decodeURIComponent(match[1]!);
      const hostname = new URL(url).hostname;
      if (
        hostname.includes("duckduckgo.") ||
        hostname.includes("google.") ||
        hostname.includes("bing.")
      ) continue;
      if (/\.(pdf|zip|tar|gz|exe|dmg|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(url)) continue;
      if (!urls.includes(url)) urls.push(url);
    } catch { /* invalid URL */ }
  }
  return urls;
}

/** Hostname is on the curated authoritative-source list (official docs, standards bodies). */
export function isAuthoritativeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return AUTHORITATIVE_DOMAINS.split("|").some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
  } catch {
    return false;
  }
}

/** Score URLs for documentation relevance — higher score = more likely to be useful docs */
export function scoreDocUrl(url: string, query: string): number {
  const lower = url.toLowerCase();
  let score = 0;

  // Official docs and standards bodies outrank everything else — a dev.to
  // post with a keyword-stuffed slug must never beat postgresql.org.
  if (isAuthoritativeUrl(url)) score += 20;

  if (/\/docs?\//i.test(lower)) score += 10;
  if (/\/api\//i.test(lower)) score += 10;
  if (/\/guide/i.test(lower)) score += 8;
  if (/\/reference/i.test(lower)) score += 8;
  if (/\/learn/i.test(lower)) score += 6;
  if (/\/tutorial/i.test(lower)) score += 6;
  if (/\/getting[-_]started/i.test(lower)) score += 7;
  if (/readthedocs\.(io|org)/i.test(lower)) score += 8;
  if (/github\.io/i.test(lower)) score += 3;

  // Penalize non-doc content and SEO content farms
  if (/stackoverflow\.com/i.test(lower)) score -= 5;
  if (/reddit\.com/i.test(lower)) score -= 8;
  if (/medium\.com/i.test(lower)) score -= 8;
  if (/youtube\.com/i.test(lower)) score -= 10;
  if (/(dev\.to|hashnode\.(dev|com)|dzone\.com|tutorialspoint\.com|geeksforgeeks\.org|javatpoint\.com|blog\.logrocket\.com)/i.test(lower)) score -= 12;

  // Bonus if URL contains query terms — capped so slug keyword-stuffing
  // cannot outweigh the authority signal.
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let termBonus = 0;
  for (const word of queryWords) {
    if (lower.includes(word)) termBonus += 5;
  }
  score += Math.min(termBonus, 15);

  return score;
}
