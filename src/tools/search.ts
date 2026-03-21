import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupById } from "../sources/registry.js";
import { fetchDocs, fetchWithTimeout, fetchViaJina, fetchDevDocs, isIndexContent, rankIndexLinks } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

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
    .describe("Max tokens to return (default 8000, max 20000)"),
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
    urls: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Evolution_of_HTTP"],
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
  {
    patterns: ['webassembly', 'wasm', 'web assembly', 'emscripten', 'wasm bindgen', 'wasmtime'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/WebAssembly',
      'https://webassembly.org/docs/use-cases/',
    ],
    name: 'WebAssembly',
  },
  {
    patterns: ['vector search', 'vector database', 'embeddings search', 'similarity search', 'semantic search', 'pgvector', 'pinecone', 'qdrant'],
    urls: [
      'https://docs.pinecone.io/guides/get-started/quickstart',
      'https://qdrant.tech/documentation/quick-start/',
    ],
    name: 'Vector Search / Embeddings',
  },
  {
    patterns: ['mcp protocol', 'model context protocol', 'mcp server', 'mcp client', 'mcp tool', 'build mcp', 'create mcp'],
    urls: [
      'https://modelcontextprotocol.io/introduction',
      'https://modelcontextprotocol.io/docs/concepts/tools',
    ],
    name: 'MCP Protocol',
  },
  {
    patterns: ['ai agent', 'agentic', 'llm agent', 'autonomous agent', 'multi-agent', 'tool calling', 'function calling llm'],
    urls: [
      'https://docs.anthropic.com/en/docs/build-with-claude/tool-use',
      'https://platform.openai.com/docs/guides/function-calling',
    ],
    name: 'AI Agents & Tool Calling',
  },
  {
    patterns: ['rag', 'retrieval augmented generation', 'retrieval-augmented', 'document retrieval', 'chunk embedding'],
    urls: [
      'https://docs.llamaindex.ai/en/stable/getting_started/concepts/',
      'https://docs.langchain.com/docs/use-cases/question-answering',
    ],
    name: 'RAG (Retrieval-Augmented Generation)',
  },
  {
    patterns: ['prompt engineering', 'system prompt', 'few-shot', 'chain of thought', 'prompt design', 'llm prompting'],
    urls: [
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview',
      'https://platform.openai.com/docs/guides/prompt-engineering',
    ],
    name: 'Prompt Engineering',
  },
  {
    patterns: ['grpc', 'protocol buffers', 'protobuf', 'grpc-web', 'connect rpc', 'buf schema'],
    urls: [
      'https://grpc.io/docs/what-is-grpc/introduction/',
      'https://protobuf.dev/overview/',
    ],
    name: 'gRPC / Protocol Buffers',
  },
  {
    patterns: ['server-sent events', 'eventsource', 'event stream', 'text/event-stream'],
    urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events'],
    name: 'Server-Sent Events (SSE)',
  },
  {
    patterns: ['json schema', 'json schema validation', 'json schema draft', 'ajv', 'schema validation json'],
    urls: [
      'https://json-schema.org/learn/getting-started-step-by-step',
      'https://json-schema.org/specification',
    ],
    name: 'JSON Schema',
  },
  {
    patterns: ['json-ld', 'schema.org', 'rich results', 'rich snippets', 'google structured data'],
    urls: [
      'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
      'https://schema.org/docs/gs.html',
    ],
    name: 'JSON-LD / Structured Data',
  },
  {
    patterns: ['opentelemetry', 'otel', 'distributed tracing', 'trace context', 'spans traces', 'otel collector'],
    urls: [
      'https://opentelemetry.io/docs/what-is-opentelemetry/',
      'https://opentelemetry.io/docs/languages/js/getting-started/',
    ],
    name: 'OpenTelemetry',
  },
  {
    patterns: ['email deliverability', 'dkim', 'spf record', 'dmarc', 'email dns', 'bounce rate email'],
    urls: [
      'https://resend.com/blog/email-deliverability-explained',
      'https://developers.google.com/gmail/postmaster/docs/troubleshooting',
    ],
    name: 'Email Deliverability',
  },
  {
    patterns: ['monorepo', 'pnpm workspace', 'yarn workspace', 'monorepo setup', 'workspace packages', 'nx monorepo'],
    urls: [
      'https://turbo.build/repo/docs',
      'https://nx.dev/concepts/mental-model',
    ],
    name: 'Monorepo Patterns',
  },
  {
    patterns: ['semver', 'semantic versioning', 'version bump', 'major minor patch', 'changesets', 'release workflow'],
    urls: [
      'https://semver.org/',
      'https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md',
    ],
    name: 'Semantic Versioning',
  },
  {
    patterns: ['web animations api', 'element.animate', 'keyframe animation js', 'waapi'],
    urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API'],
    name: 'Web Animations API',
  },
  {
    patterns: ['nestjs', 'nest framework', 'nestjs module', 'nestjs controller', 'nestjs provider', 'nestjs guard'],
    urls: [
      'https://docs.nestjs.com/',
      'https://docs.nestjs.com/first-steps',
    ],
    name: 'NestJS',
  },
  {
    patterns: ['elysia', 'elysiajs', 'bun web framework'],
    urls: ['https://elysiajs.com/quick-start'],
    name: 'Elysia',
  },
  {
    patterns: ['payload cms', 'payloadcms', 'payload headless'],
    urls: ['https://payloadcms.com/docs/getting-started/what-is-payload'],
    name: 'Payload CMS',
  },
  {
    patterns: ['kysely', 'kysely query builder', 'type-safe sql kysely'],
    urls: ['https://kysely.dev/docs/getting-started'],
    name: 'Kysely',
  },
  {
    patterns: ['pinia', 'vue store', 'vue state management', 'pinia setup store'],
    urls: ['https://pinia.vuejs.org/introduction.html'],
    name: 'Pinia',
  },
  {
    patterns: ['assistant-ui', 'ai chat ui react', 'react chat component library'],
    urls: ['https://www.assistant-ui.com/docs/getting-started'],
    name: 'assistant-ui',
  },
  // Backend frameworks
  {
    patterns: ['spring boot', 'spring framework', 'spring mvc', 'spring security', 'spring data', '@springbootapplication'],
    urls: [
      'https://docs.spring.io/spring-boot/docs/current/reference/html/getting-started.html',
      'https://docs.spring.io/spring-boot/docs/current/reference/html/howto.html',
    ],
    name: 'Spring Boot',
  },
  {
    patterns: ['laravel', 'php laravel', 'laravel eloquent', 'laravel blade', 'artisan'],
    urls: [
      'https://laravel.com/docs/routing',
      'https://laravel.com/docs/eloquent',
      'https://laravel.com/docs/deployment',
    ],
    name: 'Laravel',
  },
  {
    patterns: ['ruby on rails', 'rails framework', 'active record rails', 'rails routes', 'rake db'],
    urls: [
      'https://guides.rubyonrails.org/getting_started.html',
      'https://guides.rubyonrails.org/security.html',
      'https://guides.rubyonrails.org/active_record_basics.html',
    ],
    name: 'Ruby on Rails',
  },
  // Messaging / queues
  {
    patterns: ['kafka', 'apache kafka', 'kafka producer', 'kafka consumer', 'kafka topics', 'confluent'],
    urls: [
      'https://kafka.apache.org/documentation/#gettingStarted',
      'https://developer.confluent.io/learn-kafka/',
    ],
    name: 'Apache Kafka',
  },
  {
    patterns: ['rabbitmq', 'amqp', 'message broker', 'rabbit mq'],
    urls: [
      'https://www.rabbitmq.com/tutorials',
      'https://www.rabbitmq.com/documentation.html',
    ],
    name: 'RabbitMQ',
  },
  {
    patterns: ['bullmq', 'bull queue', 'job queue redis', 'worker queue nodejs'],
    urls: [
      'https://docs.bullmq.io/guide/introduction',
      'https://docs.bullmq.io/patterns/producer-consumer',
    ],
    name: 'BullMQ',
  },
  // GraphQL
  {
    patterns: ['graphql', 'graphql schema', 'graphql resolvers', 'graphql subscriptions', 'graphql best practices'],
    urls: [
      'https://graphql.org/learn/',
      'https://www.apollographql.com/docs/apollo-server/schema/schema/',
    ],
    name: 'GraphQL',
  },
  // Infrastructure
  {
    patterns: ['docker', 'dockerfile', 'docker compose', 'container build', 'docker multi-stage'],
    urls: [
      'https://docs.docker.com/develop/develop-images/instructions/',
      'https://docs.docker.com/develop/security-best-practices/',
    ],
    name: 'Docker',
  },
  {
    patterns: ['kubernetes', 'k8s', 'kubectl', 'helm chart', 'k8s deployment', 'kubernetes pod'],
    urls: [
      'https://kubernetes.io/docs/concepts/',
      'https://kubernetes.io/docs/tasks/',
    ],
    name: 'Kubernetes',
  },
  {
    patterns: ['terraform', 'iac', 'infrastructure as code', 'tf plan', 'terraform module'],
    urls: [
      'https://developer.hashicorp.com/terraform/docs',
      'https://developer.hashicorp.com/terraform/language/best-practices',
    ],
    name: 'Terraform',
  },
  {
    patterns: ['github actions', 'workflow yaml', 'ci cd github', 'github runner', 'workflow dispatch'],
    urls: [
      'https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions',
      'https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions',
    ],
    name: 'GitHub Actions',
  },
  {
    patterns: ['postgresql', 'postgres', 'pg', 'psql', 'postgres index', 'vacuum analyze'],
    urls: [
      'https://www.postgresql.org/docs/current/sql.html',
      'https://www.postgresql.org/docs/current/performance-tips.html',
    ],
    name: 'PostgreSQL',
  },
  {
    patterns: ['redis', 'redis cache', 'redis pub sub', 'redis data types', 'redis cluster'],
    urls: [
      'https://redis.io/docs/latest/develop/',
      'https://redis.io/docs/latest/develop/use/patterns/',
    ],
    name: 'Redis',
  },
  {
    patterns: ['mongodb', 'mongo', 'mongoose schema', 'aggregation pipeline', 'mongodb index'],
    urls: [
      'https://www.mongodb.com/docs/manual/introduction/',
      'https://www.mongodb.com/docs/manual/core/aggregation-pipeline/',
    ],
    name: 'MongoDB',
  },

  // ─── Supply chain / SBOM ──────────────────────────────────────────────────────
  {
    patterns: ['supply chain', 'sbom', 'software bill of materials', 'slsa', 'provenance', 'npm provenance', 'sigstore'],
    urls: [
      'https://slsa.dev/spec/v1.0/levels',
      'https://docs.npmjs.com/generating-provenance-statements',
      'https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html',
    ],
    name: 'Supply Chain Security',
  },

  // ─── API Security ─────────────────────────────────────────────────────────────
  {
    patterns: ['api security', 'api rate limiting', 'rate limiting', 'throttling', 'api authentication'],
    urls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html',
      'https://cheatsheetseries.owasp.org/cheatsheets/API_Security_Cheat_Sheet.html',
    ],
    name: 'API Security',
  },

  // ─── SSRF ─────────────────────────────────────────────────────────────────────
  {
    patterns: ['ssrf', 'server side request forgery', 'server-side request forgery'],
    urls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    ],
    name: 'SSRF Prevention',
  },

  // ─── File upload security ──────────────────────────────────────────────────────
  {
    patterns: ['file upload', 'file upload security', 'malicious upload', 'upload validation'],
    urls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html',
    ],
    name: 'File Upload Security',
  },

  // ─── Clickjacking ─────────────────────────────────────────────────────────────
  {
    patterns: ['clickjacking', 'iframe security', 'frame-ancestors', 'x-frame-options'],
    urls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html',
    ],
    name: 'Clickjacking Defense',
  },

  // ─── Path traversal ───────────────────────────────────────────────────────────
  {
    patterns: ['path traversal', 'directory traversal', 'lfi', 'local file inclusion'],
    urls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Path_Traversal_Cheat_Sheet.html',
    ],
    name: 'Path Traversal Prevention',
  },

  // ─── CSS Nesting ──────────────────────────────────────────────────────────────
  {
    patterns: ['css nesting', 'native css nesting', '@nest', 'css nest'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting/Using_CSS_nesting',
    ],
    name: 'CSS Nesting',
  },

  // ─── CSS :has() ───────────────────────────────────────────────────────────────
  {
    patterns: ['css has selector', ':has()', 'css has', 'has pseudo-class'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/:has',
    ],
    name: 'CSS :has()',
  },

  // ─── CSS Subgrid ──────────────────────────────────────────────────────────────
  {
    patterns: ['css subgrid', 'grid subgrid', 'subgrid'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid',
    ],
    name: 'CSS Subgrid',
  },

  // ─── CSS Scroll-driven Animations ─────────────────────────────────────────────
  {
    patterns: ['scroll driven animation', 'scroll-driven', 'animation-timeline', '@scroll-timeline', 'view-timeline'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations',
      'https://developer.chrome.com/docs/css-ui/scroll-driven-animations',
    ],
    name: 'CSS Scroll-driven Animations',
  },

  // ─── CSS oklch / color-mix ────────────────────────────────────────────────────
  {
    patterns: ['oklch', 'color-mix', 'css color', 'p3 color', 'wide gamut', 'oklch color space'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch',
      'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix',
    ],
    name: 'CSS Modern Colors',
  },

  // ─── CSS @scope ───────────────────────────────────────────────────────────────
  {
    patterns: ['css scope', '@scope', 'css @scope'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/CSS/@scope',
    ],
    name: 'CSS @scope',
  },

  // ─── Cloudflare Workers ───────────────────────────────────────────────────────
  {
    patterns: ['cloudflare workers', 'cloudflare pages', 'cloudflare r2', 'cloudflare kv', 'workers ai', 'cloudflare durable objects'],
    urls: [
      'https://developers.cloudflare.com/workers/',
      'https://developers.cloudflare.com/pages/',
    ],
    name: 'Cloudflare Workers',
  },

  // ─── Intl API ─────────────────────────────────────────────────────────────────
  {
    patterns: ['intl', 'ecma-402', 'internationalization api', 'intl.datetimeformat', 'intl.numberformat', 'intl.pluralrules'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl',
    ],
    name: 'Intl API (ECMA-402)',
  },

  // ─── i18next ──────────────────────────────────────────────────────────────────
  {
    patterns: ['i18next', 'react-i18next', 'next-intl', 'i18n', 'localization', 'icu message format'],
    urls: [
      'https://www.i18next.com/overview/getting-started',
      'https://unicode-org.github.io/icu/userguide/format_parse/messages/',
    ],
    name: 'i18n / Localization',
  },

  // ─── AbortController ──────────────────────────────────────────────────────────
  {
    patterns: ['abortcontroller', 'abortsignal', 'abort signal', 'cancel request', 'cancellation token'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
      'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
    ],
    name: 'AbortController',
  },

  // ─── File System Access API ────────────────────────────────────────────────────
  {
    patterns: ['file system access api', 'showopendialogpicker', 'showsavedialogpicker', 'filesystemfilehandle'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/API/File_System_API',
    ],
    name: 'File System Access API',
  },

  // ─── MCP ──────────────────────────────────────────────────────────────────────
  {
    patterns: ['model context protocol', 'mcp server', 'mcp tool', 'mcp resource', 'mcp prompt', 'mcp typescript sdk'],
    urls: [
      'https://modelcontextprotocol.io/docs/concepts/architecture',
      'https://modelcontextprotocol.io/docs/concepts/tools',
    ],
    name: 'Model Context Protocol',
  },

  // ─── AI Streaming / SSE ───────────────────────────────────────────────────────
  {
    patterns: ['ai streaming', 'sse streaming', 'server sent events ai', 'streaming llm', 'token streaming', 'ai text stream'],
    urls: [
      'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events',
      'https://sdk.vercel.ai/docs/ai-sdk-core/streaming',
    ],
    name: 'AI Streaming (SSE)',
  },

  // ─── AI Structured Output ─────────────────────────────────────────────────────
  {
    patterns: ['ai structured output', 'llm json output', 'function calling', 'tool calling', 'json mode llm', 'structured generation'],
    urls: [
      'https://platform.openai.com/docs/guides/structured-outputs',
      'https://docs.anthropic.com/en/docs/build-with-claude/tool-use',
    ],
    name: 'AI Structured Output',
  },

  // ─── k6 Load Testing ──────────────────────────────────────────────────────────
  {
    patterns: ['k6', 'load testing', 'performance testing api', 'stress testing', 'locust'],
    urls: [
      'https://grafana.com/docs/k6/latest/get-started/running-k6/',
      'https://grafana.com/docs/k6/latest/using-k6/http-requests/',
    ],
    name: 'Load Testing',
  },

  // ─── Google APIs & Services ───────────────────────────────────────────────
  {
    patterns: ['google gemini', 'gemini api', 'gemini pro', 'gemini flash', 'google ai studio'],
    urls: [
      'https://ai.google.dev/gemini-api/docs',
      'https://ai.google.dev/gemini-api/docs/get-started/tutorial',
    ],
    name: 'Google Gemini API',
  },
  {
    patterns: ['google maps', 'maps api', 'maps javascript api', 'google maps embed', 'google places'],
    urls: [
      'https://developers.google.com/maps/documentation/javascript/overview',
      'https://developers.google.com/maps/documentation/places/web-service',
    ],
    name: 'Google Maps API',
  },
  {
    patterns: ['google analytics', 'ga4', 'gtag', 'measurement protocol', 'google analytics 4'],
    urls: [
      'https://developers.google.com/analytics/devguides/collection/ga4',
      'https://developers.google.com/analytics/devguides/reporting/data/v1',
    ],
    name: 'Google Analytics 4',
  },
  {
    patterns: ['google ads api', 'google ads scripts', 'adwords api', 'google ads reporting'],
    urls: [
      'https://developers.google.com/google-ads/api/docs/start',
      'https://developers.google.com/google-ads/api/docs/best-practices/overview',
    ],
    name: 'Google Ads API',
  },
  {
    patterns: ['google search console', 'search console api', 'google webmaster', 'gsc api'],
    urls: [
      'https://developers.google.com/webmaster-tools/v1/api_reference_index',
      'https://developers.google.com/search/docs/monitor-debug/search-console-about',
    ],
    name: 'Google Search Console API',
  },
  {
    patterns: ['google sheets api', 'google spreadsheet api', 'sheets v4'],
    urls: [
      'https://developers.google.com/sheets/api/guides/concepts',
      'https://developers.google.com/sheets/api/quickstart/nodejs',
    ],
    name: 'Google Sheets API',
  },
  {
    patterns: ['google drive api', 'google drive sdk', 'drive v3'],
    urls: [
      'https://developers.google.com/drive/api/guides/about-sdk',
      'https://developers.google.com/drive/api/quickstart/nodejs',
    ],
    name: 'Google Drive API',
  },
  {
    patterns: ['google calendar api', 'google calendar sdk', 'calendar v3'],
    urls: [
      'https://developers.google.com/calendar/api/guides/overview',
      'https://developers.google.com/calendar/api/quickstart/nodejs',
    ],
    name: 'Google Calendar API',
  },
  {
    patterns: ['google oauth', 'google identity', 'google sign in', 'google login', 'google auth'],
    urls: [
      'https://developers.google.com/identity/protocols/oauth2',
      'https://developers.google.com/identity/gsi/web/guides/overview',
    ],
    name: 'Google OAuth / Identity',
  },
  {
    patterns: ['google tag manager', 'gtm', 'tag manager api', 'gtm server side'],
    urls: [
      'https://developers.google.com/tag-platform/tag-manager',
      'https://developers.google.com/tag-platform/tag-manager/server-side',
    ],
    name: 'Google Tag Manager',
  },
  {
    patterns: ['google recaptcha', 'recaptcha v3', 'recaptcha enterprise', 'captcha google'],
    urls: [
      'https://developers.google.com/recaptcha/docs/v3',
      'https://cloud.google.com/recaptcha-enterprise/docs',
    ],
    name: 'Google reCAPTCHA',
  },
  {
    patterns: ['lighthouse', 'pagespeed insights', 'pagespeed api', 'google lighthouse'],
    urls: [
      'https://developer.chrome.com/docs/lighthouse/overview',
      'https://developers.google.com/speed/docs/insights/v5/get-started',
    ],
    name: 'Google Lighthouse / PageSpeed',
  },
  {
    patterns: ['firebase firestore', 'cloud firestore', 'firestore rules', 'firestore security'],
    urls: [
      'https://firebase.google.com/docs/firestore',
      'https://firebase.google.com/docs/firestore/security/get-started',
    ],
    name: 'Firebase Firestore',
  },
  {
    patterns: ['firebase auth', 'firebase authentication', 'firebase sign in'],
    urls: [
      'https://firebase.google.com/docs/auth',
      'https://firebase.google.com/docs/auth/web/start',
    ],
    name: 'Firebase Authentication',
  },
  {
    patterns: ['firebase functions', 'cloud functions firebase', 'firebase cloud functions'],
    urls: [
      'https://firebase.google.com/docs/functions',
      'https://firebase.google.com/docs/functions/get-started',
    ],
    name: 'Firebase Cloud Functions',
  },
  {
    patterns: ['firebase hosting', 'firebase deploy'],
    urls: ['https://firebase.google.com/docs/hosting'],
    name: 'Firebase Hosting',
  },
  {
    patterns: ['google cloud run', 'cloud run', 'gcp cloud run'],
    urls: [
      'https://cloud.google.com/run/docs',
      'https://cloud.google.com/run/docs/quickstarts',
    ],
    name: 'Google Cloud Run',
  },
  {
    patterns: ['google cloud functions', 'gcp functions', 'cloud functions gen2'],
    urls: [
      'https://cloud.google.com/functions/docs',
      'https://cloud.google.com/functions/docs/writing',
    ],
    name: 'Google Cloud Functions',
  },
  {
    patterns: ['google cloud storage', 'gcs', 'gcp storage', 'cloud storage bucket'],
    urls: [
      'https://cloud.google.com/storage/docs',
      'https://cloud.google.com/storage/docs/uploading-objects',
    ],
    name: 'Google Cloud Storage',
  },
  {
    patterns: ['bigquery', 'google bigquery', 'bq sql', 'bigquery ml'],
    urls: [
      'https://cloud.google.com/bigquery/docs',
      'https://cloud.google.com/bigquery/docs/introduction',
    ],
    name: 'Google BigQuery',
  },
  {
    patterns: ['google pub sub', 'pubsub', 'cloud pub/sub', 'gcp pubsub'],
    urls: [
      'https://cloud.google.com/pubsub/docs',
      'https://cloud.google.com/pubsub/docs/overview',
    ],
    name: 'Google Pub/Sub',
  },
  {
    patterns: ['google vertex ai', 'vertex ai', 'vertex ai studio', 'vertex ml'],
    urls: [
      'https://cloud.google.com/vertex-ai/docs',
      'https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform',
    ],
    name: 'Google Vertex AI',
  },
  {
    patterns: ['google cloud vision', 'vision api', 'google ocr', 'image recognition google'],
    urls: ['https://cloud.google.com/vision/docs'],
    name: 'Google Cloud Vision API',
  },
  {
    patterns: ['google cloud speech', 'speech to text google', 'google stt', 'google tts', 'google text to speech'],
    urls: [
      'https://cloud.google.com/speech-to-text/docs',
      'https://cloud.google.com/text-to-speech/docs',
    ],
    name: 'Google Cloud Speech APIs',
  },
  {
    patterns: ['google translate api', 'cloud translation', 'google translation api'],
    urls: ['https://cloud.google.com/translate/docs'],
    name: 'Google Cloud Translation',
  },
  {
    patterns: ['google natural language', 'google nlp', 'cloud natural language api'],
    urls: ['https://cloud.google.com/natural-language/docs'],
    name: 'Google Cloud Natural Language',
  },
  {
    patterns: ['google youtube api', 'youtube data api', 'youtube iframe api', 'youtube embed'],
    urls: [
      'https://developers.google.com/youtube/v3/getting-started',
      'https://developers.google.com/youtube/iframe_api_reference',
    ],
    name: 'YouTube API',
  },
  {
    patterns: ['gmail api', 'google gmail api', 'send email gmail api'],
    urls: ['https://developers.google.com/gmail/api/guides'],
    name: 'Gmail API',
  },
  {
    patterns: ['google workspace', 'google apps script', 'apps script'],
    urls: [
      'https://developers.google.com/apps-script',
      'https://developers.google.com/workspace',
    ],
    name: 'Google Workspace / Apps Script',
  },
  {
    patterns: ['material design', 'material ui', 'md3', 'material design 3', 'material web'],
    urls: [
      'https://m3.material.io',
      'https://m3.material.io/develop/web',
    ],
    name: 'Material Design 3',
  },
  {
    patterns: ['google fonts api', 'google web fonts', 'fonts.googleapis'],
    urls: ['https://developers.google.com/fonts/docs/getting_started'],
    name: 'Google Fonts API',
  },
  {
    patterns: ['google search api', 'custom search api', 'google programmable search'],
    urls: ['https://developers.google.com/custom-search/v1/overview'],
    name: 'Google Custom Search API',
  },
  {
    patterns: ['google seo', 'google search guidelines', 'google webmaster guidelines', 'google ranking'],
    urls: [
      'https://developers.google.com/search/docs/essentials',
      'https://developers.google.com/search/docs/appearance/google-discover',
    ],
    name: 'Google Search Guidelines',
  },
  {
    patterns: ['google chrome extensions', 'chrome extension api', 'manifest v3', 'chrome web store'],
    urls: [
      'https://developer.chrome.com/docs/extensions/get-started',
      'https://developer.chrome.com/docs/extensions/reference/api',
    ],
    name: 'Chrome Extensions',
  },
  {
    patterns: ['gke', 'google kubernetes engine', 'gcp kubernetes'],
    urls: [
      'https://cloud.google.com/kubernetes-engine/docs',
      'https://cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview',
    ],
    name: 'Google Kubernetes Engine',
  },
  {
    patterns: ['google cloud iam', 'gcp iam', 'google iam', 'google service account'],
    urls: [
      'https://cloud.google.com/iam/docs',
      'https://cloud.google.com/iam/docs/overview',
    ],
    name: 'Google Cloud IAM',
  },
  {
    patterns: ['flutter', 'dart flutter', 'flutter widget', 'flutter state management'],
    urls: [
      'https://docs.flutter.dev',
      'https://docs.flutter.dev/cookbook',
    ],
    name: 'Flutter',
  },
  {
    patterns: ['angular', 'angular signals', 'angular component', 'angular routing'],
    urls: [
      'https://angular.dev',
      'https://angular.dev/overview',
    ],
    name: 'Angular',
  },

  // ─── Anthropic / Claude API (comprehensive) ──────────────────────────────
  {
    patterns: ['claude api', 'anthropic api', 'claude messages', 'anthropic messages api'],
    urls: [
      'https://docs.anthropic.com/en/docs/quickstart',
      'https://docs.anthropic.com/en/api/messages',
    ],
    name: 'Anthropic Claude API',
  },
  {
    patterns: ['claude tool use', 'anthropic tool use', 'claude function calling', 'anthropic tools'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/tool-use'],
    name: 'Claude Tool Use',
  },
  {
    patterns: ['claude prompt caching', 'anthropic caching', 'cache_control anthropic'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching'],
    name: 'Claude Prompt Caching',
  },
  {
    patterns: ['claude vision', 'anthropic vision', 'claude image', 'anthropic image analysis'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/vision'],
    name: 'Claude Vision',
  },
  {
    patterns: ['claude extended thinking', 'anthropic thinking', 'claude reasoning', 'thinking tokens'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking'],
    name: 'Claude Extended Thinking',
  },
  {
    patterns: ['claude computer use', 'anthropic computer use', 'claude desktop automation'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/computer-use'],
    name: 'Claude Computer Use',
  },
  {
    patterns: ['claude streaming', 'anthropic streaming', 'anthropic sse', 'claude stream'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/streaming'],
    name: 'Claude Streaming',
  },
  {
    patterns: ['claude batches', 'anthropic batch', 'message batches anthropic'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/message-batches'],
    name: 'Claude Message Batches',
  },
  {
    patterns: ['claude pdf', 'anthropic pdf', 'claude document analysis'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/pdf-support'],
    name: 'Claude PDF Support',
  },
  {
    patterns: ['claude citations', 'anthropic citations', 'source citations claude'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/citations'],
    name: 'Claude Citations',
  },
  {
    patterns: ['claude models', 'anthropic models', 'claude opus', 'claude sonnet', 'claude haiku', 'claude model comparison'],
    urls: [
      'https://docs.anthropic.com/en/docs/about-claude/models',
      'https://docs.anthropic.com/en/docs/about-claude/models/all-models',
    ],
    name: 'Claude Models',
  },
  {
    patterns: ['claude rate limits', 'anthropic rate limits', 'anthropic quotas'],
    urls: ['https://docs.anthropic.com/en/api/rate-limits'],
    name: 'Anthropic Rate Limits',
  },
  {
    patterns: ['claude code', 'claude code cli', 'claude code agent', 'claude code sdk'],
    urls: [
      'https://code.claude.com/docs/en/overview',
      'https://code.claude.com/docs/en/best-practices',
    ],
    name: 'Claude Code',
  },
  {
    patterns: ['claude agent sdk', 'anthropic agent sdk', 'claude code sdk programmatic'],
    urls: [
      'https://platform.claude.com/docs/en/agent-sdk/overview',
      'https://platform.claude.com/docs/en/agent-sdk/quickstart',
    ],
    name: 'Claude Agent SDK',
  },

  // ─── OpenAI API (comprehensive) ──────────────────────────────────────────
  {
    patterns: ['openai api', 'chatgpt api', 'gpt api', 'openai chat completions'],
    urls: [
      'https://platform.openai.com/docs/overview',
      'https://platform.openai.com/docs/api-reference/chat',
    ],
    name: 'OpenAI API',
  },
  {
    patterns: ['openai responses', 'openai responses api', 'gpt responses'],
    urls: ['https://platform.openai.com/docs/api-reference/responses'],
    name: 'OpenAI Responses API',
  },
  {
    patterns: ['openai function calling', 'openai tools', 'gpt function calling', 'openai tool calling'],
    urls: ['https://platform.openai.com/docs/guides/function-calling'],
    name: 'OpenAI Function Calling',
  },
  {
    patterns: ['openai structured output', 'openai json mode', 'gpt json output'],
    urls: ['https://platform.openai.com/docs/guides/structured-outputs'],
    name: 'OpenAI Structured Output',
  },
  {
    patterns: ['openai embeddings', 'text-embedding-3', 'openai embed'],
    urls: ['https://platform.openai.com/docs/guides/embeddings'],
    name: 'OpenAI Embeddings',
  },
  {
    patterns: ['openai fine tuning', 'gpt fine tune', 'openai finetune', 'openai fine-tuning'],
    urls: ['https://platform.openai.com/docs/guides/fine-tuning'],
    name: 'OpenAI Fine-tuning',
  },
  {
    patterns: ['openai vision', 'gpt vision', 'gpt-4 vision', 'openai image understanding'],
    urls: ['https://platform.openai.com/docs/guides/vision'],
    name: 'OpenAI Vision',
  },
  {
    patterns: ['openai image generation', 'dall-e', 'dalle', 'openai images', 'gpt image'],
    urls: ['https://platform.openai.com/docs/guides/images'],
    name: 'OpenAI Image Generation',
  },
  {
    patterns: ['openai whisper', 'openai speech to text', 'openai stt', 'openai transcription'],
    urls: ['https://platform.openai.com/docs/guides/speech-to-text'],
    name: 'OpenAI Whisper / STT',
  },
  {
    patterns: ['openai tts', 'openai text to speech', 'openai voice'],
    urls: ['https://platform.openai.com/docs/guides/text-to-speech'],
    name: 'OpenAI TTS',
  },
  {
    patterns: ['openai realtime', 'openai realtime api', 'gpt realtime', 'openai voice chat'],
    urls: ['https://platform.openai.com/docs/guides/realtime'],
    name: 'OpenAI Realtime API',
  },
  {
    patterns: ['openai batch', 'openai batch api', 'gpt batch processing'],
    urls: ['https://platform.openai.com/docs/guides/batch'],
    name: 'OpenAI Batch API',
  },
  {
    patterns: ['openai moderation', 'content moderation openai', 'openai safety'],
    urls: ['https://platform.openai.com/docs/guides/moderation'],
    name: 'OpenAI Moderation',
  },
  {
    patterns: ['openai agents', 'openai agents sdk', 'openai swarm', 'openai multi agent'],
    urls: [
      'https://openai.github.io/openai-agents-python',
      'https://openai.github.io/openai-agents-python/quickstart',
    ],
    name: 'OpenAI Agents SDK',
  },
  {
    patterns: ['openai rate limits', 'openai quotas', 'openai usage limits'],
    urls: ['https://platform.openai.com/docs/guides/rate-limits'],
    name: 'OpenAI Rate Limits',
  },
  {
    patterns: ['openai best practices', 'openai production', 'gpt production best practices'],
    urls: ['https://platform.openai.com/docs/guides/production-best-practices'],
    name: 'OpenAI Production Best Practices',
  },

  // ─── Other AI Providers ──────────────────────────────────────────────────
  {
    patterns: ['mistral ai', 'mistral api', 'mistral large', 'mixtral', 'mistral nemo'],
    urls: [
      'https://docs.mistral.ai',
      'https://docs.mistral.ai/getting-started/quickstart',
    ],
    name: 'Mistral AI',
  },
  {
    patterns: ['cohere api', 'cohere embed', 'cohere rerank', 'cohere command'],
    urls: [
      'https://docs.cohere.com',
      'https://docs.cohere.com/docs/the-cohere-platform',
    ],
    name: 'Cohere',
  },
  {
    patterns: ['groq api', 'groq inference', 'groq llm', 'groq speed'],
    urls: ['https://console.groq.com/docs'],
    name: 'Groq',
  },
  {
    patterns: ['replicate api', 'replicate run', 'replicate model'],
    urls: ['https://replicate.com/docs'],
    name: 'Replicate',
  },
  {
    patterns: ['together ai', 'together api', 'together inference'],
    urls: ['https://docs.together.ai'],
    name: 'Together AI',
  },
  {
    patterns: ['hugging face', 'huggingface', 'hf inference', 'hugging face api', 'hf hub'],
    urls: [
      'https://huggingface.co/docs/api-inference',
      'https://huggingface.co/docs/huggingface.js',
    ],
    name: 'Hugging Face',
  },
  {
    patterns: ['langchain', 'langchain js', 'langchain python', 'langchain rag', 'langchain agent'],
    urls: [
      'https://js.langchain.com/docs/introduction',
      'https://python.langchain.com/docs/introduction',
    ],
    name: 'LangChain',
  },
  {
    patterns: ['langgraph', 'lang graph', 'langchain graph', 'multi agent langchain'],
    urls: ['https://langchain-ai.github.io/langgraph'],
    name: 'LangGraph',
  },
  {
    patterns: ['llamaindex', 'llama index', 'llama_index', 'llamaindex rag'],
    urls: [
      'https://docs.llamaindex.ai/en/stable',
      'https://docs.llamaindex.ai/en/stable/getting_started/concepts',
    ],
    name: 'LlamaIndex',
  },
  {
    patterns: ['crewai', 'crew ai', 'multi agent crew'],
    urls: ['https://docs.crewai.com'],
    name: 'CrewAI',
  },
  {
    patterns: ['autogen', 'microsoft autogen', 'autogen agent'],
    urls: ['https://microsoft.github.io/autogen'],
    name: 'AutoGen',
  },

  // ─── AI Concepts & Patterns ──────────────────────────────────────────────
  {
    patterns: ['fine tuning', 'fine-tuning llm', 'lora', 'qlora', 'peft', 'model fine-tuning'],
    urls: [
      'https://platform.openai.com/docs/guides/fine-tuning',
      'https://huggingface.co/docs/peft',
    ],
    name: 'LLM Fine-tuning',
  },
  {
    patterns: ['embeddings', 'text embeddings', 'sentence embeddings', 'embedding model', 'vector embeddings'],
    urls: [
      'https://platform.openai.com/docs/guides/embeddings',
      'https://huggingface.co/blog/getting-started-with-embeddings',
    ],
    name: 'Text Embeddings',
  },
  {
    patterns: ['ai safety', 'ai alignment', 'responsible ai', 'ai ethics', 'llm safety'],
    urls: [
      'https://docs.anthropic.com/en/docs/about-claude/use-case-guides',
      'https://platform.openai.com/docs/guides/safety-best-practices',
    ],
    name: 'AI Safety & Ethics',
  },
  {
    patterns: ['ai evaluation', 'llm evaluation', 'evals', 'benchmark llm', 'ai testing'],
    urls: [
      'https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals',
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview',
    ],
    name: 'AI Evaluation',
  },
  {
    patterns: ['multimodal ai', 'multimodal llm', 'vision language model', 'image and text ai'],
    urls: [
      'https://ai.google.dev/gemini-api/docs/image-understanding',
      'https://platform.openai.com/docs/guides/vision',
    ],
    name: 'Multimodal AI',
  },
  {
    patterns: ['ai code generation', 'codex', 'copilot api', 'code assistant ai'],
    urls: [
      'https://platform.openai.com/docs/guides/text-generation',
      'https://code.claude.com/docs/en/overview',
    ],
    name: 'AI Code Generation',
  },
  {
    patterns: ['voice ai', 'conversational ai', 'ai voice assistant', 'speech ai', 'ai audio'],
    urls: [
      'https://elevenlabs.io/docs',
      'https://platform.openai.com/docs/guides/realtime',
    ],
    name: 'Voice AI',
  },
  {
    patterns: ['pinecone', 'pinecone vector', 'pinecone database'],
    urls: [
      'https://docs.pinecone.io',
      'https://docs.pinecone.io/guides/get-started/quickstart',
    ],
    name: 'Pinecone',
  },
  {
    patterns: ['chromadb', 'chroma vector', 'chroma database', 'chroma embeddings'],
    urls: ['https://docs.trychroma.com'],
    name: 'Chroma',
  },
  {
    patterns: ['weaviate', 'weaviate vector', 'weaviate database'],
    urls: ['https://weaviate.io/developers/weaviate'],
    name: 'Weaviate',
  },

  // ─── Google Cloud (additional services) ───────────────────────────────
  {
    patterns: ['google cloud sql', 'cloud sql postgres', 'cloud sql mysql', 'gcp database', 'cloud sql proxy'],
    urls: ['https://cloud.google.com/sql/docs'],
    name: 'Google Cloud SQL',
  },
  {
    patterns: ['google cloud cdn', 'cloud cdn', 'gcp load balancer', 'cloud load balancing'],
    urls: ['https://cloud.google.com/cdn/docs', 'https://cloud.google.com/load-balancing/docs'],
    name: 'Google Cloud CDN / Load Balancing',
  },
  {
    patterns: ['google cloud armor', 'cloud armor', 'gcp waf', 'gcp ddos protection'],
    urls: ['https://cloud.google.com/armor/docs'],
    name: 'Google Cloud Armor',
  },
  {
    patterns: ['google cloud build', 'cloud build', 'gcp ci cd', 'cloud deploy gcp'],
    urls: ['https://cloud.google.com/build/docs'],
    name: 'Google Cloud Build',
  },
  {
    patterns: ['google secret manager', 'gcp secret manager', 'cloud secrets', 'secret manager api'],
    urls: ['https://cloud.google.com/secret-manager/docs'],
    name: 'Google Secret Manager',
  },
  {
    patterns: ['dialogflow', 'google dialogflow', 'dialogflow cx', 'dialogflow es', 'google chatbot api'],
    urls: ['https://cloud.google.com/dialogflow/docs'],
    name: 'Google Dialogflow',
  },
  {
    patterns: ['google document ai', 'document ai', 'gcp document processing'],
    urls: ['https://cloud.google.com/document-ai/docs'],
    name: 'Google Document AI',
  },
  {
    patterns: ['google pay', 'google pay api', 'google wallet', 'google wallet api', 'gpay'],
    urls: ['https://developers.google.com/pay/api', 'https://developers.google.com/wallet'],
    name: 'Google Pay / Wallet',
  },

  // ─── Android / Kotlin ─────────────────────────────────────────────────
  {
    patterns: ['jetpack compose', 'android development', 'kotlin android', 'android jetpack', 'compose ui'],
    urls: ['https://developer.android.com/develop/ui/compose/documentation', 'https://developer.android.com/kotlin'],
    name: 'Android / Jetpack Compose',
  },
  {
    patterns: ['kotlin', 'kotlin coroutines', 'kotlin flows', 'kotlinx', 'kotlin multiplatform'],
    urls: ['https://kotlinlang.org/docs/home.html', 'https://kotlinlang.org/docs/coroutines-overview.html'],
    name: 'Kotlin',
  },

  // ─── AI (additional topics) ───────────────────────────────────────────
  {
    patterns: ['tiktoken', 'token counting', 'tokenization llm', 'context window tokens', 'token limit'],
    urls: ['https://platform.openai.com/tokenizer', 'https://docs.anthropic.com/en/docs/build-with-claude/token-counting'],
    name: 'LLM Tokenization',
  },
  {
    patterns: ['ai guardrails', 'llm guardrails', 'nemo guardrails', 'llm content filter', 'prompt injection defense'],
    urls: ['https://docs.guardrailsai.com'],
    name: 'AI Guardrails',
  },
  {
    patterns: ['rlhf', 'reinforcement learning human feedback', 'rlaif', 'dpo training', 'reward model'],
    urls: ['https://huggingface.co/blog/rlhf', 'https://huggingface.co/docs/trl'],
    name: 'RLHF / DPO',
  },
  {
    patterns: ['langfuse', 'helicone', 'braintrust ai', 'llm observability', 'ai tracing', 'llm monitoring'],
    urls: ['https://langfuse.com/docs', 'https://docs.helicone.ai'],
    name: 'AI Observability',
  },
  {
    patterns: ['ollama', 'local llm', 'llama cpp', 'vllm', 'run llm locally', 'self hosted llm'],
    urls: ['https://github.com/ollama/ollama', 'https://docs.vllm.ai'],
    name: 'Local LLMs',
  },
  {
    patterns: ['ai orchestration', 'llm orchestration', 'agentic workflow', 'agent memory', 'agent planning'],
    urls: ['https://langchain-ai.github.io/langgraph/concepts/', 'https://python.langchain.com/docs/concepts/agents'],
    name: 'AI Orchestration',
  },
  {
    patterns: ['claude token counting', 'anthropic token count', 'count tokens claude'],
    urls: ['https://docs.anthropic.com/en/docs/build-with-claude/token-counting'],
    name: 'Claude Token Counting',
  },
  {
    patterns: ['openai reasoning', 'openai o1', 'openai o3', 'o1 model', 'o3 model', 'reasoning model openai'],
    urls: ['https://platform.openai.com/docs/guides/reasoning'],
    name: 'OpenAI Reasoning Models',
  },
  {
    patterns: ['openai file search', 'openai vector store', 'openai retrieval', 'openai knowledge base'],
    urls: ['https://platform.openai.com/docs/guides/file-search'],
    name: 'OpenAI File Search',
  },
  {
    patterns: ['custom gpt', 'gpt actions', 'gpt builder', 'openai gpts', 'chatgpt plugin'],
    urls: ['https://platform.openai.com/docs/actions/introduction'],
    name: 'ChatGPT Actions / Custom GPTs',
  },
];

export function findTopicUrls(query: string): Array<{ urls: string[]; name: string }> {
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
  "developer.mozilla.org|web.dev|owasp.org|cheatsheetseries.owasp.org|w3.org|webkit.org|whatwg.org|tc39.es|v8.dev|nodejs.org|docs.github.com|webaim.org|www.typescriptlang.org|vitest.dev|playwright.dev|jestjs.io|docs.astro.build|svelte.dev|vuejs.org|reactnative.dev|" +
  "docs.nestjs.com|elysiajs.com|hono.dev|tanstack.com|kysely.dev|opentelemetry.io|turbo.build|nx.dev|biome.sh|bun.sh|deno.com|docs.deno.com|" +
  // AI / LLM providers
  "docs.anthropic.com|code.claude.com|platform.claude.com|platform.openai.com|openai.github.io|ai.google.dev|docs.mistral.ai|docs.cohere.com|console.groq.com|replicate.com|docs.together.ai|docs.fireworks.ai|" +
  "modelcontextprotocol.io|js.langchain.com|python.langchain.com|langchain-ai.github.io|docs.llamaindex.ai|docs.crewai.com|microsoft.github.io|" +
  // AI audio/image
  "elevenlabs.io|developers.deepgram.com|www.assemblyai.com|platform.stability.ai|fal.ai|" +
  // Hugging Face
  "huggingface.co|" +
  // Vector databases
  "docs.pinecone.io|docs.trychroma.com|weaviate.io|qdrant.tech|" +
  // ML frameworks
  "pytorch.org|www.tensorflow.org|" +
  // Google
  "developers.google.com|cloud.google.com|firebase.google.com|developer.chrome.com|m3.material.io|angular.dev|docs.flutter.dev|" +
  // React Native / Mobile
  "reactnavigation.org|motion.dev|pinia.vuejs.org|docs.partykit.io|assistant-ui.com|" +
  // Infrastructure
  "grpc.io|protobuf.dev|json-schema.org|semver.org|webassembly.org|" +
  // CMS
  "payloadcms.com|strapi.io|docs.expo.dev|" +
  "supabase.com|redis.io|mongodb.com|postgresql.org|orm.drizzle.team|prisma.io|mongoosejs.com|" +
  // Services
  "docs.stripe.com|resend.com|socket.io|fastify.dev|trpc.io|authjs.dev|better-auth.com|upstash.com|posthog.com|docs.sentry.io|docs.n8n.io|trigger.dev|" +
  // Frameworks
  "storybook.js.org|threejs.org|docs.solidjs.com|remix.run|nuxt.com|" +
  "effect.website|valibot.dev|jotai.org|stately.ai|" +
  "developers.cloudflare.com|grafana.com|unicode-org.github.io";

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
    "gt_search",
    {
      title: "Search Any Topic",
      description: `Search for latest best practices, docs, or guidance on ANY topic — no library name needed. Current year: ${currentYear}.

Works for: library patterns, web standards (MDN), security (OWASP), accessibility (WCAG), performance (Core Web Vitals), APIs, auth standards (OAuth 2.1, WebAuthn), infrastructure, and more.

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
          let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, query);
          if (isIndexContent(fetchResult.content)) {
            const deepLinks = rankIndexLinks(fetchResult.content, query);
            for (const deepUrl of deepLinks) {
              const deepContent = await fetchViaJina(deepUrl);
              if (deepContent && deepContent.length > 300) {
                fetchResult = { content: deepContent, url: deepUrl, sourceType: "jina" };
                break;
              }
            }
          }
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

      // 3. devdocs.io — covers 200+ technologies: standard libs, databases, servers, languages
      if (results.length === 0) {
        const slug = query.split(/\s+/)[0] ?? query;
        const devDocsContent = await fetchDevDocs(slug, query).catch(() => null);
        if (devDocsContent && devDocsContent.length > 200) {
          const safe = sanitizeContent(devDocsContent);
          const { text } = extractRelevantContent(safe, query, Math.floor(tokens * 0.6));
          if (text.length > 100) {
            const devDocsUrl = `https://devdocs.io/${encodeURIComponent(slug.toLowerCase())}/`;
            results.push({ source: "DevDocs", url: devDocsUrl, content: text });
          }
        }
      }

      // 4. If still no results, try web search for authoritative URLs then fetch via Jina
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

      // 5. Fallback — try fetching MDN search
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
              text: `No results found for: "${query}"\n\nTry:\n- gt_resolve_library to find a specific library\n- gt_get_docs with a library ID\n- A more specific query (e.g., "React hooks best practices" instead of "React")`,
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
