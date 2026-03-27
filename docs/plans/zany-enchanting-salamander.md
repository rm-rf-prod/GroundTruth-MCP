# GT MCP Server: Universal Best Practices Improvement Plan

## Context

The GT MCP server (v3.4.0) has a critical gap: `gt_best_practices` hard-fails for any library not in the 422-entry registry, returning "Library not found." Meanwhile, `gt_get_docs` gracefully handles dynamic IDs (`npm:express`, `pypi:flask`, raw URLs) through a fallback chain. The same issue exists in `gt_migration` and `gt_changelog`. The goal is to make every tool return useful, current results for ANY library -- whether it's in the registry or not.

Research confirms the approach: hybrid resolution (static registry + dynamic fallback) is the industry standard for MCP documentation tools. GroundTruth already has all the pieces -- they just need to be wired together.

---

## Phase 1: Extract Shared Resolution Service

**Why**: Resolution functions (`resolveFromNpm`, `resolveFromPypi`, `resolveFromCrates`, `resolveFromGo`, `probeLlmsTxt`) are private to `src/tools/resolve.ts`. Other tools can't use them.

### Steps

1. **Create `src/services/resolve.ts`** -- Extract from `src/tools/resolve.ts`:
   - `resolveFromNpm()` (lines 62-92)
   - `resolveFromPypi()` (lines 94-131)
   - `resolveFromCrates()` (lines 133-170)
   - `resolveFromGo()` (lines 172-197)
   - `probeLlmsTxt()` (lines 35-47)
   - `extractGithubUrl()` (lines 49-60)
   - Add a new `resolveDynamic(libraryId: string)` function that handles prefix parsing:
     - `npm:pkg` -> `resolveFromNpm`
     - `pypi:pkg` -> `resolveFromPypi`
     - `crates:pkg` -> `resolveFromCrates`
     - `go:module` -> `resolveFromGo`
     - `http(s)://...` -> validate via `assertPublicUrl`, return as docsUrl
     - bare name with `.` -> try as hostname
     - bare name -> try npm first, then pypi
   - Return type: `{ docsUrl, displayName, githubUrl?, llmsTxtUrl?, llmsFullTxtUrl? } | null`

2. **Update `src/tools/resolve.ts`** -- Import from `../services/resolve.js` instead of having local copies. Tool handler unchanged.

3. **Create `src/services/resolve.test.ts`** -- Tests for `resolveDynamic()` covering all prefix paths and edge cases.

### Files
- NEW: `src/services/resolve.ts`
- NEW: `src/services/resolve.test.ts`
- MODIFY: `src/tools/resolve.ts` (imports only)

---

## Phase 2: gt_best_practices Accepts Any Library

**Why**: This is the #1 user-facing gap. Users ask about any library and expect best practices.

### Steps

1. **Modify handler in `src/tools/best-practices.ts`** (lines 1316-1327) -- Replace the hard-fail with a fallback chain:
   ```typescript
   const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);

   let docsUrl: string;
   let llmsTxtUrl: string | undefined;
   let llmsFullTxtUrl: string | undefined;
   let githubUrl: string | undefined;
   let displayName: string;
   let bestPracticesPaths: string[] | undefined;

   if (entry) {
     docsUrl = entry.docsUrl;
     llmsTxtUrl = entry.llmsTxtUrl;
     llmsFullTxtUrl = entry.llmsFullTxtUrl;
     githubUrl = entry.githubUrl;
     displayName = entry.name;
     bestPracticesPaths = entry.bestPracticesPaths;
   } else {
     const resolved = await resolveDynamic(libraryId);
     if (!resolved) {
       return { content: [{ type: "text", text: `Could not resolve "${libraryId}". Try gt_resolve_library first.` }] };
     }
     docsUrl = resolved.docsUrl;
     llmsTxtUrl = resolved.llmsTxtUrl;
     llmsFullTxtUrl = resolved.llmsFullTxtUrl;
     githubUrl = resolved.githubUrl;
     displayName = resolved.displayName;
   }
   ```

2. **Update input schema description** to note dynamic IDs are accepted.

3. **Update tests** in `src/tools/best-practices.test.ts`:
   - The "not found" test changes behavior (now tries dynamic resolution before failing)
   - Add tests for `npm:some-package`, `pypi:some-package`, URL-based, and bare name inputs
   - Verify registry entries still take priority

### Files
- MODIFY: `src/tools/best-practices.ts` (~30 lines)
- MODIFY: `src/tools/best-practices.test.ts` (update + add tests)

---

## Phase 3: Apply Dynamic Resolution to Migration and Changelog

**Why**: Same dead-end pattern exists in these tools.

### Steps

1. **Update `src/tools/migration.ts`** (line 78-86) -- Add `resolveDynamic` fallback after registry lookup fails. The migration tool needs `githubUrl` (for MIGRATION.md, releases) and `docsUrl` (for migration URL suffixes).

2. **Update `src/tools/changelog.ts`** -- Add same fallback. The changelog tool needs `githubUrl` for release notes.

3. **Update tests** for both tools.

### Files
- MODIFY: `src/tools/migration.ts`
- MODIFY: `src/tools/changelog.ts`
- MODIFY: `src/tools/changelog.test.ts`

---

## Phase 4: Improve Best Practices Content Quality

**Why**: Dynamic libraries lack curated URLs, so the generic fallback must be smarter.

### Steps

1. **Enhance `fetchBestPracticesContent` in `src/tools/best-practices.ts`**:
   - After curated URL race fails, try sitemap-based discovery via existing `fetchSitemapUrls()` from `src/services/fetcher.ts` -- look for URLs containing "best-practice", "guide", "pattern", "getting-started"
   - Add aggressive llms.txt probing for dynamic libraries (try `{docsUrl}/llms-full.txt` and `{docsUrl}/llms.txt` before generic suffix scan)

2. **Improve quality scoring in `src/utils/quality.ts`**:
   - Add freshness signal: boost score when content mentions current year (2025, 2026)
   - Add code density factor: ratio of code blocks to total content
   - Add list/step structure detection: best practices often use ordered lists

3. **Add lazy llms.txt discovery for registry entries** -- When an entry has no `llmsTxtUrl`, probe once per session and cache the result in `resolveCache` with key `llms-probe:{origin}`.

### Files
- MODIFY: `src/tools/best-practices.ts` (fetchBestPracticesContent enhancements)
- MODIFY: `src/utils/quality.ts` (3 new scoring factors)
- MODIFY: `src/tools/docs.ts` (add lazy llms.txt probe for registry entries)

---

## Phase 5: GitHub Token Consistency

**Why**: `GT_GITHUB_TOKEN` is only used in `gt_examples`. All GitHub API calls should use it to get 5000 req/hr instead of 60.

### Steps

1. **Audit `src/services/fetcher.ts`** -- Ensure `githubAuthHeaders()` is used in:
   - `fetchGitHubContent()`
   - `fetchGitHubReleases()`
   - `fetchGitHubExamples()`
   - Any `raw.githubusercontent.com` fetches

2. Export `githubAuthHeaders()` or make it a module-level helper accessible to all GitHub fetch functions.

### Files
- MODIFY: `src/services/fetcher.ts`

---

## Phase 6: Search Tool Freshness

**Why**: Web search results can be stale; topic map URLs should be kept current.

### Steps

1. **Add `normalizeQueryYear` to more tools** -- Currently only in search tool. Apply to best-practices and docs tools when constructing search queries.

2. **Add current-year hint to deep-fetch URL construction** -- When building topic URLs in `src/services/deep-fetch.ts`, include year-aware slug variants (e.g., `{slug}-2026`).

3. **Improve web search URL extraction** -- The `extractUrlsFromHtml` function in search.ts can be made more robust by adding more authoritative domains to the priority list and handling Brave/Bing result page format variations.

### Files
- MODIFY: `src/tools/search.ts` (minor)
- MODIFY: `src/tools/best-practices.ts` (add year normalization)
- MODIFY: `src/services/deep-fetch.ts` (year-aware slugs)

---

## Execution Order

```
Phase 1 (Foundation)          ~1hr   -- Extract shared resolution service
  |
Phase 2 (Primary Goal)       ~45min -- gt_best_practices dynamic resolution
  |
  +---> Phase 3               ~30min -- Migration/changelog dynamic resolution
  +---> Phase 4               ~45min -- Content quality improvements
  +---> Phase 5               ~15min -- GitHub token consistency
  +---> Phase 6               ~30min -- Search freshness
```

Phases 3-6 are independent after Phase 2.

---

## Verification

After each phase:
1. `npm run typecheck` -- zero errors
2. `npm run test` -- all 770+ tests pass
3. `npm run lint` -- zero warnings

End-to-end verification after all phases:
1. Test `gt_best_practices` with a registry library: `{ libraryId: "vercel/next.js", topic: "caching" }`
2. Test `gt_best_practices` with a dynamic library: `{ libraryId: "npm:fastify", topic: "performance" }` -- should return content, not "not found"
3. Test `gt_best_practices` with a bare name: `{ libraryId: "express", topic: "security" }` -- should resolve via npm and return content
4. Test `gt_migration` with a dynamic library: `{ libraryId: "npm:prisma" }`
5. Test `gt_changelog` with a dynamic library: `{ libraryId: "npm:zod" }`
6. Test `gt_search` to confirm freshness improvements
7. `npm run build` -- successful build
8. `npm audit` -- no high/critical vulnerabilities

---

## Risk Assessment

- **Backward compatible**: Tool schemas unchanged. Registry libraries behave identically. The only change is that previously-failing inputs now succeed.
- **Test impact**: One test in `best-practices.test.ts` needs updating (the "not found" test, since behavior changes from hard-fail to dynamic resolution). All other tests pass.
- **Performance**: Dynamic resolution adds latency for non-registry libraries (~200-500ms for npm API + llms.txt probe). Acceptable because: (a) only for non-registry libs, (b) results are cached, (c) returning nothing is worse.
