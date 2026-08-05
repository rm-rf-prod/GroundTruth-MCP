/**
 * Curated topic-to-URL map for docs-only topics that have no npm package.
 * Covers MDN, OWASP, W3C, WHATWG, IETF and other authoritative sources.
 *
 * Data table, not logic: it is exempt from the 200-line source convention for
 * the same reason the library registry is.
 */
export interface TopicUrlEntry {
  patterns: string[];
  urls: string[];
  name: string;
}

export const TOPIC_URL_MAP: TopicUrlEntry[] = [
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
      "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    ],
    name: "CORS",
  },
  // Auth Standards
  {
    patterns: ["jwt", "json web token", "bearer token"],
    urls: [
      "https://jwt.io/introduction",
      "https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html",
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
      "https://www.w3.org/WAI/WCAG22/quickref/",
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
    patterns: ["row level security", "rls", "postgres policies"],
    urls: [
      "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
      "https://supabase.com/docs/guides/database/postgres/row-level-security",
    ],
    name: "Postgres Row Level Security",
  },
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
    urls: ["https://nodejs.org/learn", "https://github.com/goldbergyoni/nodebestpractices"],
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
      'https://react.dev/reference/rules',
      'https://react.dev/learn/you-might-not-need-an-effect',
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
      'https://nextjs.org/docs/app/guides/caching',
      'https://nextjs.org/docs/app/getting-started/caching-and-revalidating',
    ],
    name: 'Next.js Caching & Rendering',
  },
  {
    patterns: ['next.js routing', 'nextjs app router', 'parallel routes', 'intercepting routes', 'next.js middleware'],
    urls: [
      'https://nextjs.org/docs/app/getting-started/layouts-and-pages',
      'https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes',
    ],
    name: 'Next.js Routing',
  },
  // React Native / Expo
  {
    patterns: ['react native', 'react-native', 'expo sdk', 'expo router', 'expo app'],
    urls: [
      'https://reactnative.dev/docs/getting-started',
      'https://docs.expo.dev/get-started/introduction',
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
    urls: ['https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/'],
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
    urls: ['https://www.nativewind.dev/docs/getting-started/installation'],
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
      "https://web.dev/articles/responsive-web-design-basics",
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
      "https://developers.google.com/search/docs/crawling-indexing",
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
      "https://web.dev/learn/design/internationalization",
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
      "https://developers.google.com/search/docs/monitor-debug/search-console-start",
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
      "https://developers.google.com/search/docs/appearance",
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
    urls: ["https://www.postgresql.org/docs/current/tutorial-sql.html"],
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
      "https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html",
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
      "https://nextjs.org/docs/app/getting-started/server-and-client-components",
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
