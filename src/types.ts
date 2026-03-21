export interface LibraryEntry {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  docsUrl: string;
  llmsTxtUrl?: string;
  llmsFullTxtUrl?: string;
  githubUrl?: string;
  npmPackage?: string;
  pypiPackage?: string;
  language: string[];
  tags: string[];
  bestPracticesPaths?: string[];
}

export interface LibraryMatch {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  llmsTxtUrl: string | undefined;
  llmsFullTxtUrl?: string;
  githubUrl: string | undefined;
  score: number;
  source: "registry" | "npm" | "pypi" | "github" | "crates" | "go";
}

export interface DocResult {
  content: string;
  sourceUrl: string;
  sourceType: "llms-txt" | "llms-full-txt" | "jina" | "github-readme" | "direct" | "npm";
  libraryId: string;
  topic: string;
  truncated: boolean;
  cachedAt: string;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface FetchResult {
  content: string;
  url: string;
  sourceType: DocResult["sourceType"];
  contentHash?: string;
  fetchedAt?: string;
}

export interface NpmPackageInfo {
  name: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string };
  keywords?: string[];
  "dist-tags"?: { latest?: string };
}

export interface PypiPackageInfo {
  info: {
    name: string;
    summary?: string;
    home_page?: string;
    project_urls?: Record<string, string>;
    keywords?: string;
  };
}

export interface ChangelogResult {
  libraryId: string;
  libraryName: string;
  version: string | null;
  releases: Array<{ tag: string; date: string; body: string }>;
  sourceUrl: string;
  truncated: boolean;
}

export interface CompatResult {
  feature: string;
  environments: Array<{
    name: string;
    supported: boolean | "partial";
    since?: string;
    notes?: string;
  }>;
  sourceUrl: string;
}

export interface CompareResult {
  libraries: Array<{
    id: string;
    name: string;
    description: string;
    docsUrl: string;
    content: string;
  }>;
  criteria: string;
}
