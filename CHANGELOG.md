# Changelog

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
