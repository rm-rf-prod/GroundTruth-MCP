import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupById } from "../sources/registry.js";
import { fetchDocs, fetchWithTimeout, fetchDevDocs, fetchAsMarkdownRace, isErrorPage } from "../services/fetcher.js";
import { extractRelevantContent, normalizeQueryYear } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT, CACHE_TTLS } from "../constants.js";

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
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe(`Max tokens to return (default: ${DEFAULT_TOKEN_LIMIT}, max: ${MAX_TOKEN_LIMIT})`),
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
  // Speculation Rules — see expanded entry below in Chrome Platform section
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
    patterns: ["docker", "dockerfile", "docker compose", "multi-stage build", "docker best practices"],
    urls: [
      "https://docs.docker.com/build/building/best-practices/",
      "https://docs.docker.com/get-started/",
    ],
    name: "Docker",
  },
  {
    patterns: ["kubernetes", "k8s", "pod", "deployment yaml"],
    urls: ["https://kubernetes.io/docs/concepts/"],
    name: "Kubernetes",
  },
  {
    patterns: ["github actions", "ci/cd", "workflow yaml", "github workflow", "github actions best practices"],
    urls: [
      "https://docs.github.com/en/actions/writing-workflows",
      "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions",
    ],
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
  // React (core)
  {
    patterns: ['react server components', 'rsc', 'server component', 'use client', 'use server', 'react server'],
    urls: [
      'https://react.dev/reference/rsc/server-components',
      'https://react.dev/reference/rsc/use-server',
    ],
    name: 'React Server Components',
  },
  {
    patterns: ['react hooks', 'usestate', 'useeffect', 'usememo', 'usecallback', 'useref', 'usecontext'],
    urls: [
      'https://react.dev/reference/react/hooks',
      'https://react.dev/learn/escape-hatches',
    ],
    name: 'React Hooks',
  },
  {
    patterns: ['react patterns', 'react best practices', 'react architecture', 'thinking in react'],
    urls: [
      'https://react.dev/learn/thinking-in-react',
      'https://react.dev/learn/managing-state',
    ],
    name: 'React Patterns',
  },
  {
    patterns: ['react 19', 'react actions', 'useactionstate', 'useoptimistic', 'react form actions'],
    urls: [
      'https://react.dev/blog/2024/12/05/react-19',
      'https://react.dev/reference/react/useActionState',
    ],
    name: 'React 19',
  },
  // Next.js specific topics
  {
    patterns: ['next.js caching', 'nextjs cache', 'use cache', 'cache components', 'next.js rendering'],
    urls: [
      'https://nextjs.org/docs/app/building-your-application/caching',
      'https://nextjs.org/docs/app/building-your-application/rendering',
    ],
    name: 'Next.js Caching & Rendering',
  },
  {
    patterns: ['next.js routing', 'nextjs app router', 'parallel routes', 'intercepting routes', 'next.js middleware'],
    urls: [
      'https://nextjs.org/docs/app/building-your-application/routing',
      'https://nextjs.org/docs/app/building-your-application/routing/parallel-routes',
    ],
    name: 'Next.js Routing',
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

  // Schema.org / Structured Data / Rich Results
  {
    patterns: ["schema.org", "structured data", "json-ld", "rich results", "rich snippets"],
    urls: [
      "https://schema.org/docs/gs.html",
      "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    ],
    name: "Schema.org / Structured Data",
  },
  {
    patterns: ["localbusiness", "local business schema", "areaserved", "local seo schema", "geo schema"],
    urls: [
      "https://schema.org/LocalBusiness",
      "https://developers.google.com/search/docs/appearance/structured-data/local-business",
    ],
    name: "LocalBusiness Schema",
  },
  {
    patterns: ["organization schema", "organization structured data"],
    urls: [
      "https://schema.org/Organization",
      "https://developers.google.com/search/docs/appearance/structured-data/organization",
    ],
    name: "Organization Schema",
  },
  {
    patterns: ["faq schema", "faq structured data", "faqpage"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/faqpage"],
    name: "FAQ Schema",
  },
  {
    patterns: ["breadcrumb schema", "breadcrumb structured data"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/breadcrumb"],
    name: "Breadcrumb Schema",
  },
  {
    patterns: ["article schema", "article structured data", "newsarticle"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/article"],
    name: "Article Schema",
  },
  {
    patterns: ["product schema", "product structured data", "review schema", "aggregate rating"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/product"],
    name: "Product Schema",
  },
  {
    patterns: ["howto schema", "how-to structured data"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/how-to"],
    name: "HowTo Schema",
  },
  {
    patterns: ["sitelinks searchbox", "website schema", "searchaction"],
    urls: ["https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox"],
    name: "Sitelinks Searchbox Schema",
  },

  // SEO Topics
  {
    patterns: ["internal linking", "link equity", "link juice", "anchor text", "nofollow", "rel nofollow"],
    urls: [
      "https://developers.google.com/search/docs/crawling-indexing/links-crawlable",
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    ],
    name: "Internal Linking / Link Equity",
  },
  {
    patterns: ["link building", "backlink", "backlinks", "link building strategy", "off-page seo"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      "https://developers.google.com/search/docs/essentials/spam-policies",
    ],
    name: "Link Building / Backlinks",
  },
  {
    patterns: ["robots.txt", "robots txt", "crawl budget", "crawling", "google indexing", "search indexing"],
    urls: [
      "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
      "https://developer.mozilla.org/en-US/docs/Glossary/Robots.txt",
    ],
    name: "Robots.txt / Crawling",
  },
  {
    patterns: ["sitemap", "xml sitemap", "sitemap.xml"],
    urls: ["https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview"],
    name: "XML Sitemaps",
  },
  {
    patterns: ["canonical", "canonical url", "duplicate content", "rel canonical"],
    urls: ["https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"],
    name: "Canonical URLs",
  },
  {
    patterns: ["hreflang", "international seo", "multilingual", "multi-language"],
    urls: [
      "https://developers.google.com/search/docs/specialty/international/localized-versions",
    ],
    name: "Hreflang / International SEO",
  },
  {
    patterns: ["seo", "search engine optimization", "google ranking", "serp"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      "https://web.dev/explore/progressive-web-apps",
    ],
    name: "SEO Fundamentals",
  },
  {
    patterns: ["heading hierarchy", "heading structure", "h1 h2 h3", "heading seo"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements",
      "https://webaim.org/techniques/semanticstructure/",
    ],
    name: "Heading Hierarchy",
  },
  {
    patterns: ["e-e-a-t", "eeat", "expertise experience authority trust", "google quality"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
    ],
    name: "E-E-A-T / Content Quality",
  },
  {
    patterns: ["page experience", "mobile friendly", "mobile first", "mobile usability"],
    urls: [
      "https://developers.google.com/search/docs/appearance/page-experience",
      "https://web.dev/articles/mobile-first-design",
    ],
    name: "Page Experience / Mobile",
  },

  // Website Building & Launch
  {
    patterns: ["website launch checklist", "go live checklist", "pre-launch checklist", "website launch"],
    urls: [
      "https://web.dev/articles/vitals",
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    ],
    name: "Website Launch Checklist",
  },
  {
    patterns: ["website migration", "site migration", "url migration", "domain migration", "redirect mapping"],
    urls: [
      "https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes",
      "https://developers.google.com/search/docs/crawling-indexing/301-redirects",
    ],
    name: "Website Migration / Redirects",
  },
  {
    patterns: ["responsive design", "media queries", "responsive layout", "mobile responsive", "breakpoints"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design",
      "https://web.dev/articles/responsive-web-design-basics",
    ],
    name: "Responsive Design",
  },
  {
    patterns: ["dark mode", "dark theme", "color scheme", "prefers-color-scheme", "theme toggle"],
    urls: [
      "https://web.dev/articles/prefers-color-scheme",
      "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme",
    ],
    name: "Dark Mode / Color Scheme",
  },
  {
    patterns: ["custom error page", "404 page", "error page design", "not found page"],
    urls: [
      "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404",
    ],
    name: "Custom Error Pages (404/500)",
  },
  {
    patterns: ["url structure", "url design", "clean urls", "url best practices", "slug"],
    urls: [
      "https://developers.google.com/search/docs/crawling-indexing/url-structure",
    ],
    name: "URL Structure Best Practices",
  },
  {
    patterns: ["pagination seo", "paginated content", "rel next prev", "infinite scroll seo"],
    urls: [
      "https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading",
    ],
    name: "Pagination SEO",
  },
  {
    patterns: ["image seo", "image alt text", "image search", "image optimization seo", "image filename"],
    urls: [
      "https://developers.google.com/search/docs/appearance/google-images",
      "https://web.dev/learn/images",
    ],
    name: "Image SEO",
  },
  {
    patterns: ["video seo", "video structured data", "video schema", "video sitemap", "videoobject"],
    urls: [
      "https://developers.google.com/search/docs/appearance/video",
      "https://developers.google.com/search/docs/appearance/structured-data/video",
    ],
    name: "Video SEO",
  },
  {
    patterns: ["local seo", "google business profile", "google my business", "local search", "local pack"],
    urls: [
      "https://developers.google.com/search/docs/appearance/structured-data/local-business",
      "https://support.google.com/business/answer/7091",
    ],
    name: "Local SEO / Google Business Profile",
  },
  {
    patterns: ["technical seo", "technical seo checklist", "technical seo audit", "seo audit"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      "https://developers.google.com/search/docs/crawling-indexing/overview",
    ],
    name: "Technical SEO Checklist",
  },
  {
    patterns: ["on-page seo", "on page seo", "title tag", "meta description", "header tags seo"],
    urls: [
      "https://developers.google.com/search/docs/appearance/title-link",
      "https://developers.google.com/search/docs/appearance/snippet",
    ],
    name: "On-Page SEO (Title/Meta/Headers)",
  },
  // DNS & SSL
  {
    patterns: ["dns records", "dns configuration", "cname record", "a record", "mx record", "txt record"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Glossary/DNS",
      "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/",
    ],
    name: "DNS Records & Configuration",
  },
  {
    patterns: ["ssl certificate", "https setup", "tls certificate", "let's encrypt", "ssl installation"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
      "https://web.dev/articles/why-https-matters",
    ],
    name: "SSL/TLS Certificate Setup",
  },
  // CDN & Hosting
  {
    patterns: ["cdn", "content delivery network", "edge caching", "cloudflare cdn", "cdn best practices"],
    urls: [
      "https://web.dev/articles/content-delivery-networks",
      "https://developer.mozilla.org/en-US/docs/Glossary/CDN",
    ],
    name: "CDN / Content Delivery Network",
  },
  // Privacy & Legal
  {
    patterns: ["cookie consent", "cookie banner", "gdpr cookies", "cookie policy", "consent management"],
    urls: [
      "https://developers.google.com/tag-platform/security/guides/consent",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies",
    ],
    name: "Cookie Consent / GDPR",
  },
  {
    patterns: ["gdpr", "dsgvo", "data protection", "privacy policy", "datenschutz"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/Privacy",
    ],
    name: "GDPR / Data Protection",
  },
  {
    patterns: ["impressum", "imprint", "legal notice", "german website legal"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    ],
    name: "Impressum / Legal Notice",
  },
  // Caching Strategies
  {
    patterns: ["browser caching", "caching strategy", "cache-first", "stale-while-revalidate", "network-first"],
    urls: [
      "https://web.dev/articles/service-worker-caching-and-http-caching",
      "https://developer.mozilla.org/en-US/docs/Web/API/Cache",
    ],
    name: "Caching Strategies",
  },
  // Internationalization
  {
    patterns: ["internationalization", "i18n", "localization", "l10n", "translation", "multi-language website"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Glossary/Internationalization",
      "https://web.dev/articles/i18n",
    ],
    name: "Internationalization (i18n)",
  },
  // Web Components
  {
    patterns: ["web components", "custom elements", "shadow dom", "html templates", "lit element"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/API/Web_Components",
    ],
    name: "Web Components",
  },
  // API Best Practices
  {
    patterns: ["api design", "api best practices", "api versioning", "api documentation", "api rate limiting"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods",
      "https://swagger.io/docs/specification/v3_0/about/",
    ],
    name: "API Design Best Practices",
  },
  // Error Handling
  {
    patterns: ["error handling", "error boundary", "try catch", "error monitoring", "error tracking"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch",
    ],
    name: "Error Handling Best Practices",
  },
  // Logging
  {
    patterns: ["logging best practices", "structured logging", "log levels", "server logging"],
    urls: [
      "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
    ],
    name: "Logging Best Practices",
  },

  // Google Search Central (advanced)
  {
    patterns: ["google search console", "gsc", "search console api", "url inspection"],
    urls: [
      "https://developers.google.com/search/docs/monitor-debug/search-console-about",
      "https://developers.google.com/webmaster-tools/v1/api_reference_index",
    ],
    name: "Google Search Console",
  },
  {
    patterns: ["google indexing api", "indexing api", "request indexing", "submit url google"],
    urls: [
      "https://developers.google.com/search/apis/indexing-api/v3/quickstart",
    ],
    name: "Google Indexing API",
  },
  {
    patterns: ["google search api", "custom search api", "programmable search"],
    urls: [
      "https://developers.google.com/custom-search/v1/overview",
    ],
    name: "Google Custom Search API",
  },
  {
    patterns: ["google pagespeed", "pagespeed insights", "pagespeed api", "lighthouse api"],
    urls: [
      "https://developers.google.com/speed/docs/insights/v5/get-started",
    ],
    name: "Google PageSpeed Insights API",
  },
  {
    patterns: ["google spam policies", "google search essentials", "google webmaster guidelines", "search quality"],
    urls: [
      "https://developers.google.com/search/docs/essentials",
      "https://developers.google.com/search/docs/essentials/spam-policies",
    ],
    name: "Google Search Essentials / Spam Policies",
  },
  {
    patterns: ["google discover", "discover feed", "google news", "news publisher"],
    urls: [
      "https://developers.google.com/search/docs/appearance/google-discover",
      "https://developers.google.com/search/docs/appearance/publication-overview",
    ],
    name: "Google Discover / News",
  },
  {
    patterns: ["rich results", "rich snippets", "search appearance", "google search features"],
    urls: [
      "https://developers.google.com/search/docs/appearance/visual-elements-gallery",
      "https://developers.google.com/search/docs/appearance/structured-data/search-gallery",
    ],
    name: "Google Rich Results / Search Appearance",
  },
  {
    patterns: ["google merchant center", "google shopping", "product feed", "shopping structured data"],
    urls: [
      "https://developers.google.com/shopping-content/guides/quickstart",
      "https://support.google.com/merchants/answer/7052112",
    ],
    name: "Google Merchant Center / Shopping",
  },
  {
    patterns: ["google analytics 4", "ga4 setup", "ga4 events", "ga4 api", "gtag"],
    urls: [
      "https://developers.google.com/analytics/devguides/collection/ga4",
      "https://developers.google.com/analytics/devguides/reporting/data/v1",
    ],
    name: "Google Analytics 4 (GA4)",
  },
  {
    patterns: ["google tag manager", "gtm setup", "gtm container", "tag manager api"],
    urls: [
      "https://developers.google.com/tag-platform/tag-manager/web",
      "https://developers.google.com/tag-platform/tag-manager/api/v2",
    ],
    name: "Google Tag Manager (GTM)",
  },
  {
    patterns: ["google ads api", "google ads conversion", "google ads tracking", "gclid"],
    urls: [
      "https://developers.google.com/google-ads/api/docs/start",
      "https://developers.google.com/google-ads/api/docs/conversions/overview",
    ],
    name: "Google Ads API",
  },
  {
    patterns: ["google maps api", "google maps javascript", "maps embed", "places api", "geocoding api"],
    urls: [
      "https://developers.google.com/maps/documentation/javascript/overview",
      "https://developers.google.com/maps/documentation/places/web-service/overview",
    ],
    name: "Google Maps Platform",
  },
  {
    patterns: ["google fonts api", "google fonts css", "font loading google"],
    urls: [
      "https://developers.google.com/fonts/docs/getting_started",
      "https://developers.google.com/fonts/docs/css2",
    ],
    name: "Google Fonts API",
  },
  {
    patterns: ["google recaptcha", "recaptcha v3", "recaptcha enterprise", "bot protection google"],
    urls: [
      "https://developers.google.com/recaptcha/docs/v3",
      "https://cloud.google.com/recaptcha/docs/overview",
    ],
    name: "Google reCAPTCHA",
  },
  {
    patterns: ["google sign-in", "google identity", "google oauth", "google one tap", "sign in with google"],
    urls: [
      "https://developers.google.com/identity/gsi/web/guides/overview",
      "https://developers.google.com/identity/protocols/oauth2",
    ],
    name: "Google Identity / Sign-In",
  },
  {
    patterns: ["google cloud run", "cloud run deploy", "cloud run container"],
    urls: [
      "https://cloud.google.com/run/docs/overview/what-is-cloud-run",
      "https://cloud.google.com/run/docs/quickstarts",
    ],
    name: "Google Cloud Run",
  },
  {
    patterns: ["google cloud storage", "gcs bucket", "cloud storage api"],
    urls: [
      "https://cloud.google.com/storage/docs/introduction",
      "https://cloud.google.com/storage/docs/best-practices",
    ],
    name: "Google Cloud Storage",
  },
  {
    patterns: ["google cloud functions", "cloud functions deploy", "gcf"],
    urls: [
      "https://cloud.google.com/functions/docs/concepts/overview",
    ],
    name: "Google Cloud Functions",
  },
  {
    patterns: ["bigquery", "google bigquery", "bigquery sql", "bigquery api"],
    urls: [
      "https://cloud.google.com/bigquery/docs/introduction",
      "https://cloud.google.com/bigquery/docs/best-practices-performance-overview",
    ],
    name: "Google BigQuery",
  },
  {
    patterns: ["google ai studio", "gemini api", "gemini model", "google generative ai"],
    urls: [
      "https://ai.google.dev/gemini-api/docs",
      "https://ai.google.dev/gemini-api/docs/get-started/tutorial",
    ],
    name: "Google Gemini API / AI Studio",
  },
  {
    patterns: ["vertex ai", "google vertex", "vertex model garden"],
    urls: [
      "https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform",
    ],
    name: "Google Vertex AI",
  },
  {
    patterns: ["firebase hosting", "firebase deploy", "firebase auth", "firebase firestore", "firebase realtime"],
    urls: [
      "https://firebase.google.com/docs/web/setup",
      "https://firebase.google.com/docs/hosting",
    ],
    name: "Firebase",
  },
  {
    patterns: ["google consent mode", "consent mode v2", "google privacy", "google consent"],
    urls: [
      "https://developers.google.com/tag-platform/security/guides/consent",
    ],
    name: "Google Consent Mode",
  },
  {
    patterns: ["google web vitals", "chrome user experience report", "crux", "crux api"],
    urls: [
      "https://developers.google.com/web/tools/chrome-user-experience-report",
      "https://developer.chrome.com/docs/crux",
    ],
    name: "Chrome UX Report (CrUX)",
  },

  // Chrome Platform / Browser APIs
  {
    patterns: ["speculation rules", "prefetch", "prerender", "instant navigation", "speculative loading"],
    urls: [
      "https://developer.chrome.com/docs/web-platform/prerender-pages",
      "https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API",
    ],
    name: "Speculation Rules API",
  },
  {
    patterns: ["permissions policy", "feature policy", "document policy"],
    urls: [
      "https://developer.chrome.com/docs/privacy-security/permissions-policy",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy",
    ],
    name: "Permissions Policy",
  },
  {
    patterns: ["reporting api", "nel", "network error logging", "report-to"],
    urls: ["https://developer.chrome.com/docs/capabilities/web-apis/reporting-api"],
    name: "Reporting API / NEL",
  },
  {
    patterns: ["trusted types", "dom xss", "dom-based xss prevention"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API"],
    name: "Trusted Types API",
  },
  {
    patterns: ["priority hints", "fetchpriority", "resource priority"],
    urls: ["https://web.dev/articles/fetch-priority"],
    name: "Priority Hints / fetchpriority",
  },
  {
    patterns: ["subresource integrity", "sri", "integrity attribute"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity"],
    name: "Subresource Integrity (SRI)",
  },
  {
    patterns: ["popover api", "popover", "popup"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/API/Popover_API"],
    name: "Popover API",
  },
  {
    patterns: ["dialog element", "modal dialog", "html dialog"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog"],
    name: "HTML Dialog Element",
  },
  {
    patterns: ["scroll-driven animation", "scroll timeline", "view timeline"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations"],
    name: "Scroll-driven Animations",
  },
  {
    patterns: ["css nesting", "css nest", "nested css"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting"],
    name: "CSS Nesting",
  },
  {
    patterns: ["css has selector", ":has()", "parent selector css"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/:has"],
    name: "CSS :has() Selector",
  },
  {
    patterns: ["color-mix", "oklch", "oklab", "css color spaces", "css color function"],
    urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/color_value"],
    name: "CSS Color Functions",
  },

  // Database Topics
  {
    patterns: ["sql", "sql query", "sql optimization", "sql performance", "database query"],
    urls: ["https://www.postgresql.org/docs/current/sql-select.html"],
    name: "SQL",
  },
  {
    patterns: ["database design", "database schema", "normalization", "database modeling"],
    urls: ["https://www.postgresql.org/docs/current/ddl.html"],
    name: "Database Design",
  },

  // Email / Communication
  {
    patterns: ["email authentication", "spf", "dkim", "dmarc", "email deliverability"],
    urls: [
      "https://cheatsheetseries.owasp.org/cheatsheets/Email_Security_Cheat_Sheet.html",
    ],
    name: "Email Authentication (SPF/DKIM/DMARC)",
  },

  // WebAssembly
  {
    patterns: ["webassembly", "wasm", "wasm module", "wasm javascript"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/WebAssembly",
      "https://developer.mozilla.org/en-US/docs/WebAssembly/Concepts",
    ],
    name: "WebAssembly",
  },
  // Rendering strategies
  {
    patterns: ["server side rendering", "static site generation", "incremental static", "ssr vs ssg", "isr rendering", "rendering strategy"],
    urls: [
      "https://nextjs.org/docs/app/building-your-application/rendering",
      "https://web.dev/articles/rendering-on-the-web",
    ],
    name: "Rendering Strategies (SSR/SSG/ISR)",
  },
  // HTTP fundamentals
  {
    patterns: ["http status code", "301 redirect", "302 redirect", "307 redirect", "status codes"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections",
    ],
    name: "HTTP Status Codes & Redirects",
  },
  // JavaScript fundamentals
  {
    patterns: ["event loop", "microtask", "macrotask", "promise queue", "javascript runtime"],
    urls: [
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop",
    ],
    name: "JavaScript Event Loop",
  },
  // Web Development General
  {
    patterns: ["building website", "build website", "new website", "website best practices", "website checklist"],
    urls: [
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      "https://web.dev/explore/learn-core-web-vitals",
    ],
    name: "Website Best Practices",
  },

  // AI / LLM
  {
    patterns: ["prompt engineering", "prompt design", "prompt best practices"],
    urls: [
      "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
      "https://platform.openai.com/docs/guides/prompt-engineering",
    ],
    name: "Prompt Engineering",
  },
  {
    patterns: ["rag", "retrieval augmented generation", "vector search"],
    urls: [
      "https://python.langchain.com/docs/tutorials/rag/",
    ],
    name: "RAG / Retrieval Augmented Generation",
  },
  {
    patterns: ["llms.txt", "ai crawling", "llms txt standard"],
    urls: ["https://llmstxt.org/"],
    name: "llms.txt Standard",
  },
];

/** Cache compiled regexes for topic patterns to avoid re-creation per call */
const patternRegexCache = new Map<string, RegExp>();

function matchesPattern(query: string, pattern: string): boolean {
  // Multi-word patterns and long patterns: simple includes is safe
  if (pattern.length >= 5 || pattern.includes(" ")) {
    return query.includes(pattern);
  }
  // Short patterns (< 5 chars): use word boundary to prevent substring matches
  // e.g. "ts" must not match "robots" or "events"
  let re = patternRegexCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?:^|[\\s,;:()\\[\\]/])${escaped}(?:$|[\\s,;:()\\[\\]/])`, "i");
    patternRegexCache.set(pattern, re);
  }
  return re.test(query);
}

export function findTopicUrls(query: string): Array<{ urls: string[]; name: string }> {
  const q = query.toLowerCase();
  const matches: Array<{ urls: string[]; name: string; score: number }> = [];

  for (const topic of TOPIC_URL_MAP) {
    let score = 0;
    for (const pattern of topic.patterns) {
      if (matchesPattern(q, pattern)) {
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

  // Use fetchAsMarkdownRace: tries direct HTML extraction first, Jina as fallback
  const raw = await fetchAsMarkdownRace(url);
  if (!raw || raw.length < 200 || isErrorPage(raw)) return "";
  const safe = sanitizeContent(raw);
  const { text } = extractRelevantContent(safe, query, tokens);
  docCache.set(cacheKey, text, CACHE_TTLS.SEARCH_RESULT);
  return text;
}


const AUTHORITATIVE_DOMAINS =
  "developer.mozilla.org|web.dev|owasp.org|cheatsheetseries.owasp.org|w3.org|webkit.org|whatwg.org|tc39.es|v8.dev|nodejs.org|docs.github.com|webaim.org|www.typescriptlang.org|vitest.dev|playwright.dev|jestjs.io|docs.astro.build|svelte.dev|vuejs.org|reactnative.dev|react.dev|nextjs.org|tailwindcss.com|orm.drizzle.team|supabase.com|vercel.com|docs.nestjs.com|fastapi.tiangolo.com|docs.python.org|doc.rust-lang.org|go.dev|kotlinlang.org|docs.flutter.dev|angular.dev|tanstack.com|hono.dev|elysiajs.com|zod.dev|prisma.io|stripe.com|clerk.com|authjs.dev|docs.expo.dev|firebase.google.com|ai.google.dev|platform.openai.com|docs.anthropic.com|sdk.vercel.ai|docs.deno.com|bun.sh|docs.sentry.io|turbo.build|biomejs.dev|docs.docker.com|kubernetes.io|docs.github.com|vite.dev|redis.io|www.postgresql.org|www.mongodb.com|developer.chrome.com|schema.org|developers.google.com|css-tricks.com|smashingmagazine.com|www.w3schools.com|learn.microsoft.com|docs.aws.amazon.com|cloud.google.com|docs.cloudflare.com|graphql.org|grpc.io|opentelemetry.io|www.elastic.co|helm.sh|prometheus.io|grafana.com|llmstxt.org|docs.pydantic.dev|docs.rs|crates.io|pkg.go.dev|hex.pm|hexdocs.pm|pub.dev|pypi.org|rubygems.org|packagist.org|nuget.org|mvnrepository.com|expressjs.com|fastify.dev|elixir-lang.org|www.rust-lang.org|kotlinlang.org|www.scala-lang.org|typst.app|daisyui.com|ui.shadcn.com|headlessui.com|mantine.dev|ant.design|mui.com|chakra-ui.com|www.radix-ui.com|ariakit.org";

const AUTHORITATIVE_URL_PATTERN = new RegExp(
  `https?:\\/\\/(?:${AUTHORITATIVE_DOMAINS})[^"<\\s]*`,
  "g",
);

/** Extract URLs from HTML anchor href attributes (standard search result format) */
function extractHrefUrls(html: string): string[] {
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

function extractUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  let match;

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
 * Universal direct URL construction — the global fallback that makes ANY topic findable.
 * For any query, we construct URLs on well-known documentation sites using the query as a slug.
 * This ensures we never return "no results" for a topic that has documentation somewhere.
 */
/** Keywords that signal a query maps to a known docs URL path (not a generic phrase) */
const DIRECT_URL_KEYWORDS = new Set([
  "css", "html", "http", "api", "dom", "svg", "wasm", "webgl", "webrtc", "websocket",
  "fetch", "worker", "storage", "canvas", "audio", "video", "media", "font", "form",
  "grid", "flex", "animation", "transition", "transform", "selector", "pseudo", "layer",
  "container", "nesting", "has", "popover", "dialog", "details", "summary",
  "header", "cors", "csp", "hsts", "cookie", "cache", "redirect", "status",
  "xss", "csrf", "sqli", "ssrf", "injection", "authentication", "authorization", "session",
  "schema", "json-ld", "structured-data", "breadcrumb", "faq", "article", "product",
  "localbusiness", "organization", "howto", "sitelinks", "searchaction",
  "intersection", "resize", "mutation", "observer", "indexeddb", "crypto",
  "service-worker", "push", "notification", "geolocation", "clipboard", "drag",
  "view-transition", "scroll-driven", "speculation", "prerender", "prefetch",
  "lcp", "inp", "cls", "fid", "ttfb", "performance", "vitals", "lazy-loading",
  "accessibility", "aria", "role", "tabindex", "focus", "landmark",
  "sitemap", "robots", "canonical", "hreflang", "noindex", "crawl",
]);

function buildDirectDocsUrls(query: string): Array<{ url: string; name: string }> {
  const slug = query
    .toLowerCase()
    .replace(/\b(?:best practices|latest|how to|guide|tutorial|docs?|documentation|api|reference)\b/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug || slug.length < 2) return [];

  // Only construct direct URLs when the slug contains a recognized technical term
  const slugWords = slug.split("-");
  const hasKnownTerm = slugWords.some((w) => DIRECT_URL_KEYWORDS.has(w));
  if (!hasKnownTerm) return [];

  const candidates: Array<{ url: string; name: string }> = [];

  // Google Search Developers (SEO, structured data, Search Console)
  candidates.push(
    { url: `https://developers.google.com/search/docs/appearance/structured-data/${slug}`, name: "Google Search Central" },
    { url: `https://developers.google.com/search/docs/${slug}`, name: "Google Search Docs" },
  );

  // MDN Web Docs (the universal web reference)
  candidates.push(
    { url: `https://developer.mozilla.org/en-US/docs/Web/API/${slug.replace(/-/g, "_")}`, name: "MDN Web API" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/CSS/${slug}`, name: "MDN CSS" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/${slug}`, name: "MDN HTML" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/HTTP/${slug}`, name: "MDN HTTP" },
  );

  // web.dev (performance, best practices)
  candidates.push(
    { url: `https://web.dev/articles/${slug}`, name: "web.dev" },
  );

  // Chrome DevRel (browser APIs, platform features)
  candidates.push(
    { url: `https://developer.chrome.com/docs/web-platform/${slug}`, name: "Chrome DevRel" },
    { url: `https://developer.chrome.com/docs/capabilities/${slug}`, name: "Chrome Capabilities" },
  );

  // OWASP (security)
  candidates.push(
    { url: `https://cheatsheetseries.owasp.org/cheatsheets/${slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_")}_Cheat_Sheet.html`, name: "OWASP Cheat Sheet" },
  );

  // Schema.org (structured data)
  const pascalSlug = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  candidates.push(
    { url: `https://schema.org/${pascalSlug}`, name: "Schema.org" },
  );

  return candidates;
}

/**
 * Build Jina Reader fallback URLs for queries that don't match any known pattern.
 * Uses web.dev search and Google Search Central as last-resort documentation sources.
 */
function buildJinaFallbackUrls(query: string): Array<{ url: string; name: string }> {
  const encoded = encodeURIComponent(query);
  return [
    { url: `https://web.dev/search?q=${encoded}`, name: "web.dev search" },
    { url: `https://developers.google.com/search?q=${encoded}`, name: "Google Developers search" },
  ];
}

/**
 * Search MDN Web Docs via their free JSON API (no auth, no rate limit issues).
 * Returns doc page URLs sorted by relevance. Ideal for web standards, CSS, HTML, JS, HTTP.
 */
async function searchMDN(query: string): Promise<Array<{ url: string; title: string }>> {
  try {
    const res = await fetchWithTimeout(
      `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US&size=5`,
      8000,
    );
    if (!res.ok) return [];
    const data = await res.json() as { documents?: Array<{ mdn_url?: string; title?: string; summary?: string }> };
    if (!Array.isArray(data?.documents)) return [];
    return data.documents
      .filter((d) => d.mdn_url && d.title)
      .map((d) => ({
        url: `https://developer.mozilla.org${d.mdn_url}`,
        title: d.title ?? "",
      }));
  } catch {
    return [];
  }
}

/**
 * DuckDuckGo Instant Answer API — returns structured results without HTML scraping.
 * Free, no auth required. Returns topic summary + related topics with URLs.
 * Falls back gracefully (returns empty array) when no instant answer exists.
 */
async function searchDDGInstant(query: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      8000,
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      AbstractURL?: string;
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
      Results?: Array<{ FirstURL?: string }>;
    };
    const urls: string[] = [];
    if (data.AbstractURL) urls.push(data.AbstractURL);
    if (Array.isArray(data.Results)) {
      for (const r of data.Results.slice(0, 3)) {
        if (r.FirstURL) urls.push(r.FirstURL);
      }
    }
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 3)) {
        if (t.FirstURL) urls.push(t.FirstURL);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Extract real URLs from DuckDuckGo redirect wrappers.
 * DDG wraps all result links through //duckduckgo.com/l/?uddg=ENCODED_URL
 * The uddg= parameter contains the actual destination URL.
 * This pattern has been stable for 4+ years and is more reliable than HTML class scraping.
 */
function extractDDGUrls(html: string): string[] {
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

/** Score URLs for documentation relevance — higher score = more likely to be useful docs */
function scoreDocUrl(url: string, query: string): number {
  const lower = url.toLowerCase();
  let score = 0;

  if (/\/docs?\//i.test(lower)) score += 10;
  if (/\/api\//i.test(lower)) score += 10;
  if (/\/guide/i.test(lower)) score += 8;
  if (/\/reference/i.test(lower)) score += 8;
  if (/\/learn/i.test(lower)) score += 6;
  if (/\/tutorial/i.test(lower)) score += 6;
  if (/\/getting[-_]started/i.test(lower)) score += 7;
  if (/readthedocs\.(io|org)/i.test(lower)) score += 8;
  if (/github\.io/i.test(lower)) score += 3;

  // Penalize non-doc content
  if (/stackoverflow\.com/i.test(lower)) score -= 5;
  if (/reddit\.com/i.test(lower)) score -= 8;
  if (/medium\.com/i.test(lower)) score -= 3;
  if (/youtube\.com/i.test(lower)) score -= 10;

  // Bonus if URL contains query terms
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  for (const word of queryWords) {
    if (lower.includes(word)) score += 5;
  }

  return score;
}

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * SearXNG public instances with JSON API support.
 * Rotated with circuit breaker to handle instance downtime.
 * These are community-run — expect occasional failures.
 */
const SEARXNG_INSTANCES = [
  "https://paulgo.io",
  "https://priv.au",
  "https://opnxng.com",
  "https://baresearch.org",
];

async function searchSearXNG(query: string): Promise<string[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
        8000,
      );
      if (!res.ok) continue;
      const data = await res.json() as { results?: Array<{ url?: string; title?: string }> };
      if (!Array.isArray(data?.results) || data.results.length === 0) continue;
      return data.results
        .filter((r) => r.url && r.url.startsWith("http"))
        .map((r) => r.url!)
        .slice(0, 8);
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Multi-engine web search with prioritized fallback chain.
 * 1. DuckDuckGo HTML (uddg= extraction — most reliable)
 * 2. DuckDuckGo Lite (simpler HTML, same extraction)
 * 3. SearXNG JSON API (structured, but public instances are flaky)
 * 4. Mojeek HTML (direct URLs, no redirect wrappers, smaller index)
 * 5. Legacy: extractUrlsFromHtml for any search engine HTML
 *
 * Bing and Brave are deliberately excluded:
 * - Bing returns Cloudflare PoW challenges for server-side requests
 * - Brave uses SvelteKit CSR — no results in SSR HTML
 */
async function webSearch(query: string): Promise<string[]> {
  const docsHint = "official docs documentation guide reference";
  const searchQuery = `${query} ${docsHint}`;
  const encoded = encodeURIComponent(searchQuery);

  // 1. DuckDuckGo HTML — uddg= parameter extraction (stable 4+ years)
  try {
    const res = await fetchWithTimeout(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      10_000,
      { Accept: "text/html", "User-Agent": BROWSER_UA },
    );
    if (res.ok) {
      const html = await res.text();
      const urls = extractDDGUrls(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
      // Fallback to generic extraction if uddg pattern missing
      const legacyUrls = extractUrlsFromHtml(html);
      if (legacyUrls.length > 0) return legacyUrls;
    }
  } catch { /* DDG HTML failed */ }

  // 2. DuckDuckGo Lite — even simpler HTML, same uddg= pattern
  try {
    const res = await fetchWithTimeout(
      `https://lite.duckduckgo.com/lite/?q=${encoded}`,
      10_000,
      { Accept: "text/html", "User-Agent": BROWSER_UA },
    );
    if (res.ok) {
      const html = await res.text();
      const urls = extractDDGUrls(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
    }
  } catch { /* DDG Lite failed */ }

  // 3. SearXNG JSON API — structured results, rotate across public instances
  try {
    const searxUrls = await searchSearXNG(searchQuery);
    if (searxUrls.length > 0) {
      return searxUrls
        .map((url) => ({ url, score: scoreDocUrl(url, query) }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.url);
    }
  } catch { /* SearXNG failed */ }

  // 4. Mojeek — independent search engine, direct URLs (no redirect wrappers)
  try {
    const res = await fetchWithTimeout(
      `https://www.mojeek.com/search?q=${encoded}`,
      10_000,
      { Accept: "text/html", "User-Agent": BROWSER_UA },
    );
    if (res.ok) {
      const html = await res.text();
      // Mojeek uses direct hrefs — no redirect wrapping
      const urls = extractUrlsFromHtml(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
    }
  } catch { /* Mojeek failed */ }

  return [];
}

export function registerSearchTool(server: McpServer): void {
  const currentYear = new Date().getFullYear();
  server.registerTool(
    "gt_search",
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
- gt_search({ query: "latest best practices" }) — auto-detects from project context
- gt_search({ query: "WCAG 2.2 keyboard navigation" })
- gt_search({ query: "SQL injection prevention ${currentYear}" })
- gt_search({ query: "CSS container queries browser support" })
- gt_search({ query: "React Server Components patterns" })`,
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

      // 3. Try direct URL construction for common documentation sites
      if (results.length === 0) {
        const directUrls = buildDirectDocsUrls(query);
        if (directUrls.length > 0) {
          const directResults = await Promise.allSettled(
            directUrls.slice(0, 4).map(async (candidate) => {
              const content = await fetchTopicContent(candidate.url, query, Math.floor(tokens / 2));
              if (content.length > 200) {
                return { source: candidate.name, url: candidate.url, content };
              }
              throw new Error("no content");
            }),
          );
          for (const result of directResults) {
            if (result.status === "fulfilled") {
              results.push(result.value);
              if (results.length >= 2) break;
            }
          }
        }
      }

      // 4. MDN JSON API search — free, structured, no scraping needed
      if (results.length === 0) {
        const mdnResults = await searchMDN(query);
        if (mdnResults.length > 0) {
          const mdnFetchResults = await Promise.allSettled(
            mdnResults.slice(0, 3).map(async (mdn) => {
              const content = await fetchTopicContent(mdn.url, query, Math.floor(tokens / 2));
              if (content.length > 200) {
                return { source: `MDN: ${mdn.title}`, url: mdn.url, content };
              }
              throw new Error("no content");
            }),
          );
          for (const result of mdnFetchResults) {
            if (result.status === "fulfilled") {
              results.push(result.value);
              if (results.length >= 2) break;
            }
          }
        }
      }

      // 4b. DuckDuckGo Instant Answer API — free structured JSON, no HTML scraping
      if (results.length === 0) {
        const ddgUrls = await searchDDGInstant(query);
        if (ddgUrls.length > 0) {
          const ddgFetchResults = await Promise.allSettled(
            ddgUrls.slice(0, 3).map(async (url) => {
              const content = await fetchTopicContent(url, query, Math.floor(tokens / 2));
              if (content.length > 200) {
                let source: string;
                try { source = new URL(url).hostname; } catch { source = url; }
                return { source, url, content };
              }
              throw new Error("no content");
            }),
          );
          for (const result of ddgFetchResults) {
            if (result.status === "fulfilled") {
              results.push(result.value);
              if (results.length >= 2) break;
            }
          }
        }
      }

      // 5. If still no results, try web search for authoritative URLs then fetch via Jina
      if (results.length === 0) {
        const searchUrls = await webSearch(query);
        // Fetch top 3 search results in parallel for speed
        const searchResults = await Promise.allSettled(
          searchUrls.slice(0, 3).map(async (url) => {
            const content = await fetchTopicContent(url, query, Math.floor(tokens / 2));
            if (content.length > 200) {
              let source: string;
              try { source = new URL(url).hostname; } catch { source = url; }
              return { source, url, content };
            }
            throw new Error("no content");
          }),
        );
        for (const result of searchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
            if (results.length >= 2) break;
          }
        }
      }

      // 6. Fallback — try DevDocs (pre-parsed docs for 200+ technologies)
      if (results.length === 0) {
        const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const techSlug = queryWords[0] ?? query.split(" ")[0] ?? "";
        if (techSlug) {
          const devDocsContent = await fetchDevDocs(techSlug, query);
          if (devDocsContent && devDocsContent.length > 200) {
            const safe = sanitizeContent(devDocsContent);
            const { text } = extractRelevantContent(safe, query, tokens);
            if (text.length > 200) {
              results.push({
                source: `DevDocs (${techSlug})`,
                url: `https://devdocs.io/${techSlug}/`,
                content: text,
              });
            }
          }
        }
      }

      // 7. Fallback — try Jina Reader directly on the query as a URL-like topic
      if (results.length === 0) {
        const jinaDirectUrls = buildJinaFallbackUrls(query);
        for (const candidate of jinaDirectUrls.slice(0, 2)) {
          const content = await fetchTopicContent(candidate.url, query, tokens);
          if (content.length > 200) {
            results.push({ source: candidate.name, url: candidate.url, content });
            break;
          }
        }
      }

      // 8. Fallback — try fetching MDN search
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
              text: [
                `No results found for: "${query}"`,
                "",
                "**What to try next:**",
                "- Be more specific (e.g. 'React hooks best practices' instead of 'React')",
                "- Include the library name + topic (e.g. 'Next.js middleware authentication')",
                "- Try gt_resolve_library to find a specific library, then gt_get_docs",
                "- Try gt_get_docs with a direct URL as the libraryId",
              ].join("\n"),
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
        content: [{ type: "text", text: header + body }],
        structuredContent: {
          query,
          sources: results.map((r) => ({ name: r.source, url: r.url, content: r.content })),
        },
      };
    },
  );
}
