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
  githubUrl: string | undefined;
  score: number;
  source: "registry" | "npm" | "pypi" | "github";
}

export interface DocResult {
  content: string;
  sourceUrl: string;
  sourceType: "llms-txt" | "llms-full-txt" | "jina" | "github-readme" | "direct";
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
