# Changelog

## [1.3.0] — 2026-03-18

### Added
- Extraction guard (`src/utils/guard.ts`): `isExtractionAttempt()` blocks bulk enumeration/listing/dump queries, `withNotice()` prepends ELv2 IP notice to all registry responses, `EXTRACTION_REFUSAL` returned for extraction attempts
- IP protection wired into all 5 registry-touching tools: `ws_resolve_library`, `ws_get_docs`, `ws_best_practices`, `ws_search`, `ws_auto_scan` — extraction attempts return a license violation message, not data
- PROPRIETARY DATA NOTICE added to all 4 tool descriptions that touch the registry — signals to AI models that bulk extraction violates ELv2 and AI provider policies on IP/copyright

### Changed
- All registry tool responses now prepend the ELv2 IP notice via `withNotice()` to reinforce data provenance

## [1.2.0] — 2026-03-18

### Added
- `node` audit category: 5 new patterns covering `console.log` in production, synchronous fs operations (event loop blocking), unhandled callback errors, `process.exit()` without cleanup, plain HTTP fetch
- 6 new security patterns: SQL injection via template literals (OWASP A03), command injection in child_process, SSRF via user-controlled fetch URLs, path traversal in fs functions, `NEXT_PUBLIC_` secret exposure, implied eval in setTimeout/setInterval
- 4 new accessibility patterns: `role="button"` on non-button elements (WCAG 2.1.1), `href="#"` / `href="javascript:"` placeholder links, missing `lang` attribute on `<html>`, `prefers-reduced-motion` not respected
- 4 new React patterns: conditional hook call detection (Rules of Hooks violation), component called as plain function, side effects at render scope, inline object/array props causing re-renders
- 3 new layout patterns: CSS `@import` chain detection, render-blocking `<script>` without async/defer, `document.querySelector` in React
- 4 new TypeScript patterns: `@ts-ignore` suppressor, floating Promises (no-floating-promises), `require()` instead of import, double assertion (`as unknown as T`)
- 3 new Next.js patterns: `middleware.ts` not renamed to `proxy.ts` (Next.js 16), page missing metadata export, `fetchpriority` missing on LCP image
- Block comment map: lines inside `/* */` blocks are skipped to reduce false positives
- Test file skip: `.test.`, `.spec.`, `.d.ts`, `__tests__/`, `.stories.` files are excluded from audit
- Extended `AuditPattern.test()` signature: now receives `lines[]` and `lineIndex` for context-aware multi-line checks
- Updated `fetchBestPractice()` with direct routes to typescript-eslint.io/rules, OWASP Node.js Cheat Sheet, web.dev/articles/optimize-lcp, and react.dev/reference/rules

### Changed
- Audit categories enum extended: `"node"` added alongside existing 7 categories
- Tool description updated to reflect 8 categories and 50+ patterns
- README rewritten with full pattern tables, example output, and fetch chain documentation

## [1.1.0] — 2026-03-18

### Added
- 14 new React Native and Expo libraries in the registry: `sonner-native`, `expo-notifications`, `expo-router`, `react-native-netinfo`, `expo-camera`, `expo-image-picker`, `expo-secure-store`, `expo-location`, `react-native-async-storage`, `react-native-bottom-sheet`, `react-native-paper`, `expo-haptics`, `react-native-maps`, `react-native-webview`
- 11 new topic patterns in `ws_search` for React Native and Expo queries: React Compiler, Expo Notifications, Gesture Handler, Reanimated, NetInfo, React Navigation, NativeWind, FlashList/FlatList, EAS Build, React Native New Architecture
- Obfuscated build output — compiled `dist/` is protected before publishing
- Elastic License 2.0

### Fixed
- `ws_search` no longer falls back to MDN for React Native / Expo queries — now routes to `reactnative.dev` and `docs.expo.dev`
- `react-native-gesture-handler` search now points to the correct current docs URL

## [1.0.0] — 2026-03-18

### Initial release
- 6 tools: `ws_resolve_library`, `ws_get_docs`, `ws_best_practices`, `ws_auto_scan`, `ws_search`, `ws_audit`
- 230+ library registry with llms.txt priority
- 4-step fetch chain: llms.txt → llms-full.txt → Jina Reader → GitHub README
- npm/PyPI fallback for libraries not in registry
- Code audit tool with file:line issue reporting across 7 categories
- Freeform search with curated source mapping (OWASP, MDN, web.dev, W3C, WCAG)
