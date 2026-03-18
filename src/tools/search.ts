import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupById } from "../sources/registry.js";
import { fetchDocs, fetchWithTimeout, fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "What you want to know. Can be anything: 'latest React best practices', 'WCAG 2.2 focus indicators', 'OWASP SQL injection prevention', 'CSS container queries browser support', 'JWT security', 'HTTP/3 vs HTTP/2', 'Web Workers API'. No library name required.",
    ),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(DEFAULT_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens to return"),
});

// Curated topic-to-URL map for docs-only topics that have no npm package
// Covers MDN, OWASP, W3C, WHATWG, IETF, and other authoritative sources
const TOPIC_URL_MAP: Array<{ patterns: string[]; urls: string[]; name: string }> = [
  // Security
  {
    patterns: ["owasp", "top 10", "web security", "application security"],
    urls: [
      "https://owasp.org/www-project-top-ten/",
      "https://cheatsheetseries.owasp.org/IndexTopTen.html",
    ],
    name: "OWASP Top 10",
  },
  {
    patterns: ["sql injection", "sqli", "parameterized query"],
    urls: ["https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html"],
    name: "OWASP SQL Injection",
  },
  {
    patterns: ["xss", "cross-site scripting", "content security policy", "csp"],
    urls: [
      "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
    ],
    name: "XSS Prevention / CSP",
  },
  {
    patterns: ["csrf", "cross-site request forgery"],
    urls: ["https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html"],
    name: "CSRF Prevention",
  },
  {
    patterns: ["hsts", "https", "strict transport security", "tls", "ssl"],
    urls: [
      "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
    ],
    name: "HSTS / TLS Security",
  },
  {
    patterns: ["auth", "authentication", "password", "session", "cookie"],
    urls: [
      "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
      "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
    ],
    name: "Authentication Best Practices",
  },
  {
    patterns: ["cors", "cross-origin", "access-control"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS",
      "https://cheatsheetseries.owasp.org/cheatsheets/CORS_OriginHeaderScrutiny_Cheat_Sheet.html",
    ],
    name: "CORS",
  },
  // Auth Standards
  {
    patterns: ["jwt", "json web token", "bearer token"],
    urls: [
      "https://jwt.io/introduction",
      "https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html",
    ],
    name: "JWT",
  },
  {
    patterns: ["oauth", "oauth 2", "authorization code"],
    urls: [
      "https://oauth.net/2/",
      "https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html",
    ],
    name: "OAuth 2.0 / 2.1",
  },
  {
    patterns: ["openid connect", "oidc"],
    urls: ["https://openid.net/developers/how-connect-works/"],
    name: "OpenID Connect",
  },
  {
    patterns: ["webauthn", "passkey", "fido2", "passwordless"],
    urls: [
      "https://webauthn.guide/",
      "https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API",
    ],
    name: "WebAuthn / Passkeys",
  },
  // Accessibility
  {
    patterns: ["wcag", "accessibility", "a11y", "aria", "screen reader"],
    urls: [
      "https://webaim.org/standards/wcag/checklist",
      "https://developer.mozilla.org/en-US/docs/Learn/Accessibility/WAI-ARIA_basics",
    ],
    name: "WCAG 2.2 / Accessibility",
  },
  {
    patterns: ["aria", "wai-aria", "accessible rich internet"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA"],
    name: "WAI-ARIA",
  },
  // Performance
  {
    patterns: ["core web vitals", "lcp", "cls", "inp", "fid", "web vitals"],
    urls: [
      "https://web.dev/articles/vitals",
      "https://web.dev/articles/optimize-lcp",
      "https://web.dev/articles/optimize-inp",
    ],
    name: "Core Web Vitals",
  },
  {
    patterns: ["web performance", "performance", "optimization", "loading speed"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/Performance",
      "https://web.dev/performance/",
    ],
    name: "Web Performance",
  },
  {
    patterns: ["image optimization", "webp", "avif", "lazy loading images"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Learn/Performance/Multimedia",
      "https://web.dev/articles/choose-the-right-image-format",
    ],
    name: "Image Optimization",
  },
  {
    patterns: ["speculation rules", "prefetch", "prerender", "instant navigation"],
    urls: ["https://developer.chrome.com/docs/web-platform/prerender-pages"],
    name: "Speculation Rules API",
  },
  // MDN Web APIs
  {
    patterns: ["fetch api", "fetch()", "fetchapi", "http request javascript"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch"],
    name: "Fetch API",
  },
  {
    patterns: ["web worker", "worker thread", "offscreen", "service worker"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers",
      "https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API",
    ],
    name: "Web Workers / Service Workers",
  },
  {
    patterns: ["websocket", "ws://", "realtime websocket", "socket"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API"],
    name: "WebSocket API",
  },
  {
    patterns: ["webrtc", "peer connection", "media stream", "rtc"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API"],
    name: "WebRTC",
  },
  {
    patterns: ["indexeddb", "indexed db", "browser database", "idb"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API"],
    name: "IndexedDB",
  },
  {
    patterns: ["web crypto", "subtle crypto", "encryption browser", "cryptography"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API"],
    name: "Web Crypto API",
  },
  {
    patterns: ["intersection observer", "scroll detection", "lazy load trigger"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API"],
    name: "Intersection Observer API",
  },
  {
    patterns: ["resize observer", "element size", "responsive component"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver"],
    name: "ResizeObserver",
  },
  // CSS
  {
    patterns: ["css grid", "grid layout", "css grid layout"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout",
      "https://css-tricks.com/snippets/css/complete-guide-grid/",
    ],
    name: "CSS Grid",
  },
  {
    patterns: ["flexbox", "css flex", "flex layout"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout",
      "https://css-tricks.com/snippets/css/a-guide-to-flexbox/",
    ],
    name: "CSS Flexbox",
  },
  {
    patterns: ["container queries", "css container", "@container"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries"],
    name: "CSS Container Queries",
  },
  {
    patterns: ["css custom properties", "css variables", "--var", "css custom"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties"],
    name: "CSS Custom Properties",
  },
  {
    patterns: ["view transitions", "page transitions", "view transition api"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API"],
    name: "View Transitions API",
  },
  {
    patterns: ["css cascade layers", "@layer", "css layers"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/@layer"],
    name: "CSS Cascade Layers",
  },
  // HTTP & Protocols
  {
    patterns: ["http headers", "response headers", "request headers"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers"],
    name: "HTTP Headers",
  },
  {
    patterns: ["http caching", "cache-control", "etag", "304"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
      "https://web.dev/articles/http-cache",
    ],
    name: "HTTP Caching",
  },
  {
    patterns: ["http/3", "http3", "quic", "http2", "http/2"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Connection_management_in_HTTP_1.x"],
    name: "HTTP/2 and HTTP/3",
  },
  {
    patterns: ["rest api", "restful api", "rest best practices"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods"],
    name: "REST API Design",
  },
  {
    patterns: ["openapi", "swagger", "api specification", "api documentation"],
    urls: ["https://swagger.io/docs/specification/v3_0/about/"],
    name: "OpenAPI 3.1",
  },
  {
    patterns: ["graphql", "graphql spec", "graphql best practices"],
    urls: ["https://graphql.org/learn/"],
    name: "GraphQL",
  },
  // HTML
  {
    patterns: ["html semantics", "semantic html", "html elements"],
    urls: ["https://developer.mozilla.org/en-US/docs/Glossary/Semantics#semantics_in_html"],
    name: "Semantic HTML",
  },
  {
    patterns: ["html forms", "form validation", "form elements"],
    urls: ["https://developer.mozilla.org/en-US/docs/Learn/Forms"],
    name: "HTML Forms",
  },
  {
    patterns: ["meta tags", "og tags", "open graph", "twitter card"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML/The_head_metadata_in_HTML",
      "https://ogp.me/",
    ],
    name: "Meta Tags / Open Graph",
  },
  // Infrastructure & DevOps
  {
    patterns: ["docker", "dockerfile", "container", "docker compose"],
    urls: ["https://docs.docker.com/get-started/"],
    name: "Docker",
  },
  {
    patterns: ["kubernetes", "k8s", "pod", "deployment yaml"],
    urls: ["https://kubernetes.io/docs/concepts/"],
    name: "Kubernetes",
  },
  {
    patterns: ["github actions", "ci/cd", "workflow yaml", "github workflow"],
    urls: ["https://docs.github.com/en/actions/writing-workflows"],
    name: "GitHub Actions",
  },
  {
    patterns: ["terraform", "infrastructure as code", "iac"],
    urls: ["https://developer.hashicorp.com/terraform/docs"],
    name: "Terraform",
  },
  // Databases
  {
    patterns: ["postgresql", "postgres", "psql", "pg"],
    urls: ["https://www.postgresql.org/docs/current/"],
    name: "PostgreSQL",
  },
  {
    patterns: ["redis", "redis cache", "redis commands"],
    urls: ["https://redis.io/docs/latest/"],
    name: "Redis",
  },
  {
    patterns: ["mongodb", "mongo", "mongoose", "document database"],
    urls: ["https://www.mongodb.com/docs/manual/"],
    name: "MongoDB",
  },
  // Languages
  {
    patterns: ["rust", "rust lang", "cargo", "borrowing", "ownership rust"],
    urls: ["https://doc.rust-lang.org/book/"],
    name: "Rust",
  },
  {
    patterns: ["golang", "go lang", "go programming"],
    urls: ["https://go.dev/doc/"],
    name: "Go",
  },
  {
    patterns: ["python", "python best practices", "pep8"],
    urls: ["https://docs.python.org/3/", "https://peps.python.org/pep-0008/"],
    name: "Python",
  },
  // Node.js
  {
    patterns: ["node.js", "nodejs", "node best practices"],
    urls: ["https://nodejs.org/en/docs/guides/", "https://github.com/goldbergyoni/nodebestpractices"],
    name: "Node.js",
  },
  // TypeScript
  {
    patterns: ["typescript", "ts", "tsc", "tsconfig", "type safety"],
    urls: [
      "https://www.typescriptlang.org/docs/handbook/2/types-from-types.html",
      "https://www.typescriptlang.org/tsconfig",
    ],
    name: "TypeScript",
  },
  // Testing
  {
    patterns: ["testing", "unit test", "integration test", "test best practices", "tdd"],
    urls: [
      "https://kentcdodds.com/blog/write-tests",
      "https://vitest.dev/guide/",
    ],
    name: "Testing Best Practices",
  },
  // Keyboard Navigation
  {
    patterns: ["keyboard navigation", "keyboard trap", "focus management", "tab order"],
    urls: [
      "https://webaim.org/techniques/keyboard/",
      "https://developer.mozilla.org/en-US/docs/Web/Accessibility/Keyboard-navigable_JavaScript_widgets",
    ],
    name: "Keyboard Navigation",
  },
  // Web Fonts
  {
    patterns: ["web font", "font loading", "font display", "font performance", "woff"],
    urls: [
      "https://web.dev/articles/font-best-practices",
      "https://developer.mozilla.org/en-US/docs/Learn/CSS/Styling_text/Web_fonts",
    ],
    name: "Web Fonts",
  },
  // PWA
  {
    patterns: ["pwa", "progressive web app", "service worker cache", "web app manifest", "offline"],
    urls: [
      "https://web.dev/explore/progressive-web-apps",
      "https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps",
    ],
    name: "Progressive Web Apps",
  },
  // React Native / Expo
  {
    patterns: ['react native', 'react-native', 'expo sdk', 'expo router', 'expo app'],
    urls: [
      'https://reactnative.dev/docs/getting-started',
      'https://docs.expo.dev/get-started/introduction/',
    ],
    name: 'React Native / Expo',
  },
  {
    patterns: ['react compiler', 'babel-plugin-react-compiler', 'react forget', 'auto-memoization react'],
    urls: [
      'https://docs.expo.dev/guides/react-compiler/',
      'https://react.dev/learn/react-compiler',
    ],
    name: 'React Compiler',
  },
  {
    patterns: ['expo notifications', 'expo-notifications', 'push notifications react native', 'setnotificationcategoryasync', 'notification action buttons'],
    urls: ['https://docs.expo.dev/versions/latest/sdk/notifications/'],
    name: 'Expo Notifications',
  },
  {
    patterns: ['react native gesture', 'react-native-gesture-handler', 'swipeable', 'pan gesture', 'gesture handler'],
    urls: [
      'https://docs.swmansion.com/react-native-gesture-handler/docs/',
      'https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/pan-gesture',
    ],
    name: 'React Native Gesture Handler',
  },
  {
    patterns: ['react native reanimated', 'reanimated', 'useanimatedstyle', 'withspring', 'shared value'],
    urls: ['https://docs.swmansion.com/react-native-reanimated/docs/'],
    name: 'React Native Reanimated',
  },
  {
    patterns: ['netinfo', 'react-native-netinfo', 'network status react native', 'offline banner react native', 'connectivity react native'],
    urls: ['https://github.com/react-native-netinfo/react-native-netinfo#readme'],
    name: 'React Native NetInfo',
  },
  {
    patterns: ['react navigation', 'stack navigator', 'tab navigator', 'drawer navigator', 'navigation container'],
    urls: ['https://reactnavigation.org/docs/getting-started'],
    name: 'React Navigation',
  },
  {
    patterns: ['nativewind', 'tailwind react native', 'tailwind expo'],
    urls: ['https://www.nativewind.dev/getting-started/expo-router'],
    name: 'NativeWind',
  },
  {
    patterns: ['react native performance', 'flashlist', 'flatlist optimization react native', 'recycler view react native'],
    urls: [
      'https://shopify.github.io/flash-list/docs/',
      'https://reactnative.dev/docs/optimizing-flatlist-configuration',
    ],
    name: 'React Native FlatList / FlashList',
  },
  {
    patterns: ['eas build', 'expo application services', 'eas submit', 'ota update expo'],
    urls: ['https://docs.expo.dev/build/introduction/'],
    name: 'EAS Build',
  },
  {
    patterns: ['react native new architecture', 'fabric react native', 'jsi', 'turbomodule', 'bridgeless'],
    urls: ['https://reactnative.dev/docs/new-architecture-intro'],
    name: 'React Native New Architecture',
  },

];

function findTopicUrls(query: string): Array<{ urls: string[]; name: string }> {
  const q = query.toLowerCase();
  const matches: Array<{ urls: string[]; name: string; score: number }> = [];

  for (const topic of TOPIC_URL_MAP) {
    let score = 0;
    for (const pattern of topic.patterns) {
      if (q.includes(pattern)) {
        score += pattern.split(" ").length; // longer matches score higher
      }
    }
    if (score > 0) {
      matches.push({ ...topic, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3);
}

async function fetchTopicContent(url: string, query: string, tokens: number): Promise<string> {
  const cacheKey = `search:${url}:${query.slice(0, 50)}`;
  const cached = docCache.get(cacheKey);
  if (typeof cached === "string") return cached;

  const raw = await fetchViaJina(url);
  if (!raw || raw.length < 200) return "";
  const safe = sanitizeContent(raw);
  const { text } = extractRelevantContent(safe, query, tokens);
  docCache.set(cacheKey, text);
  return text;
}

// Replace stale calendar years in queries with the current year.
// Matches 4-digit years 2020–last year that appear as standalone tokens
// (not part of ES2022, OAuth2.0, WCAG 2.1, v18.3, etc.).
function normalizeQueryYear(query: string): string {
  const currentYear = new Date().getFullYear();
  const staleYearPattern = new RegExp(
    `(?<![./\\w])(20[12][0-9])(?![./\\w])`,
    "g",
  );
  return query.replace(staleYearPattern, (match) => {
    const year = parseInt(match, 10);
    return year < currentYear ? String(currentYear) : match;
  });
}

const AUTHORITATIVE_DOMAINS =
  "developer.mozilla.org|web.dev|owasp.org|cheatsheetseries.owasp.org|w3.org|webkit.org|whatwg.org|tc39.es|v8.dev|nodejs.org|docs.github.com|webaim.org|www.typescriptlang.org|vitest.dev|playwright.dev|jestjs.io|docs.astro.build|svelte.dev|vuejs.org|reactnative.dev";

const AUTHORITATIVE_URL_PATTERN = new RegExp(
  `https?:\\/\\/(?:${AUTHORITATIVE_DOMAINS})[^"<\\s]*`,
  "g",
);

function extractUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  let match;
  while ((match = AUTHORITATIVE_URL_PATTERN.exec(html)) !== null && urls.length < 3) {
    const url = match[0]?.replace(/['">\s].*$/, "");
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Use DuckDuckGo lite HTML search, with a Bing fallback if DDG fails
async function webSearch(query: string): Promise<string[]> {
  const currentYear = new Date().getFullYear();
  const siteRestrict =
    "site:developer.mozilla.org OR site:web.dev OR site:owasp.org OR site:w3.org OR site:cheatsheetseries.owasp.org OR site:webaim.org OR site:typescriptlang.org official docs";

  // Primary: DuckDuckGo Lite
  try {
    const searchQuery = encodeURIComponent(`${query} ${currentYear} ${siteRestrict}`);
    const res = await fetchWithTimeout(
      `https://html.duckduckgo.com/html/?q=${searchQuery}`,
      10_000,
      { Accept: "text/html" },
    );
    if (res.ok) {
      const html = await res.text();
      const urls = extractUrlsFromHtml(html);
      if (urls.length > 0) return urls;
    }
  } catch { /* DDG failed — fall through */ }

  // Fallback: Bing search (structured result links in HTML)
  try {
    const bingQuery = encodeURIComponent(`${query} ${currentYear} ${siteRestrict}`);
    const res = await fetchWithTimeout(
      `https://www.bing.com/search?q=${bingQuery}`,
      10_000,
      { Accept: "text/html" },
    );
    if (res.ok) {
      const html = await res.text();
      return extractUrlsFromHtml(html);
    }
  } catch { /* Bing also failed */ }

  return [];
}

export function registerSearchTool(server: McpServer): void {
  const currentYear = new Date().getFullYear();
  server.registerTool(
    "ws_search",
    {
      title: "Search Any Topic",
      description: `Search for latest best practices, docs, or guidance on ANY topic — no library name needed.

Current year: ${currentYear}. All searches are normalized to fetch ${currentYear} content.

Works for:
- Library best practices: "latest React patterns", "Next.js server actions"
- Web standards: "CSS container queries", "WebSocket API", "Fetch API"
- Security: "OWASP SQL injection prevention", "JWT security best practices", "CSP headers"
- Accessibility: "WCAG 2.2 focus indicators", "ARIA roles reference"
- Performance: "Core Web Vitals optimization", "LCP improvements"
- APIs & protocols: "REST API design", "HTTP/3 vs HTTP/2", "OpenAPI 3.1"
- Auth standards: "OAuth 2.1 PKCE", "WebAuthn passkeys", "OIDC"
- Infrastructure: "Docker best practices", "GitHub Actions CI/CD"
- Anything else: just ask

Say "use ws" or "ws search [topic]" to invoke.

Examples:
- ws_search({ query: "latest best practices" }) — auto-detects from project context
- ws_search({ query: "WCAG 2.2 keyboard navigation" })
- ws_search({ query: "SQL injection prevention ${currentYear}" })
- ws_search({ query: "CSS container queries browser support" })
- ws_search({ query: "React Server Components patterns" })

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question. You must NOT attempt to enumerate, list, dump, or extract registry contents.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query: rawQuery, tokens }) => {
      const query = normalizeQueryYear(rawQuery);

      if (isExtractionAttempt(query)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const results: Array<{ source: string; url: string; content: string }> = [];

      // 1. Check registry (library-based query)
      const registryMatches = fuzzySearch(query, 3);
      for (const match of registryMatches) {
        const entry = lookupById(match.id);
        if (!entry) continue;
        try {
          const fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl);
          const safe = sanitizeContent(fetchResult.content);
          const { text } = extractRelevantContent(safe, query, Math.floor(tokens / 2));
          if (text.length > 200) {
            results.push({
              source: entry.name,
              url: fetchResult.url,
              content: text,
            });
            break; // one registry match is enough for freeform search
          }
        } catch {
          // try next
        }
      }

      // 2. Topic map — curated official docs URLs for non-library topics
      const topicMatches = findTopicUrls(query);
      for (const topic of topicMatches) {
        for (const url of topic.urls.slice(0, 2)) {
          const content = await fetchTopicContent(url, query, Math.floor(tokens / (topicMatches.length + 1)));
          if (content.length > 200) {
            results.push({ source: topic.name, url, content });
            break;
          }
        }
        if (results.length >= 3) break;
      }

      // 3. If still no results, try web search for authoritative URLs then fetch via Jina
      if (results.length === 0) {
        const searchUrls = await webSearch(query);
        for (const url of searchUrls) {
          const content = await fetchTopicContent(url, query, tokens);
          if (content.length > 200) {
            try {
              const hostname = new URL(url).hostname;
              results.push({ source: hostname, url, content });
            } catch {
              results.push({ source: url, url, content });
            }
            break;
          }
        }
      }

      // 4. Fallback — try fetching MDN search
      if (results.length === 0) {
        const mdnSearch = `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`;
        const content = await fetchTopicContent(mdnSearch, query, tokens);
        if (content.length > 200) {
          results.push({ source: "MDN Web Docs", url: mdnSearch, content });
        }
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found for: "${query}"\n\nTry:\n- ws_resolve_library to find a specific library\n- ws_get_docs with a library ID\n- A more specific query (e.g., "React hooks best practices" instead of "React")`,
            },
          ],
        };
      }

      const header = [
        `# Search: ${query}`,
        `> Found ${results.length} source${results.length > 1 ? "s" : ""}`,
        "",
        "---",
        "",
      ].join("\n");

      const body = results
        .map((r) => `## ${r.source}\n> Source: ${r.url}\n\n${r.content}\n\n---\n`)
        .join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + body) }],
        structuredContent: {
          query,
          sources: results.map((r) => ({ name: r.source, url: r.url, content: r.content })),
        },
      };
    },
  );
}
