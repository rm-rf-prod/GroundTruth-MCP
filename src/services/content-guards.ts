/**
 * Content quality gates. Upstreams answer 200 with error shells, bot challenges,
 * login walls and unrendered SPA markup — these detect that so garbage is never
 * cached or served as documentation.
 */

/**
 * Detect if extracted content is actually an unprocessed HTML blob.
 * JS-rendered sites return HTML shells with no real content — these should be rejected.
 */
export function isHtmlBlob(content: string): boolean {
  if (content.length < 200) return false;
  const sample = content.slice(0, 5000);
  const htmlSignals = [
    /<!DOCTYPE\s+html/i.test(sample),
    /<meta\s[^>]*charSet=/i.test(sample),
    /<link\s[^>]*rel="preload"/i.test(sample),
    /class="[^"]{50,}"/i.test(sample),
    /\bdata:text\/javascript;base64,/.test(sample),
    /\b_next\/static\//.test(sample),
    /<script[\s>]/i.test(sample),
    // Gatsby / static-site generator signals
    /id="___gatsby"/i.test(sample),
    /data-react-helmet="true"/i.test(sample),
    // Generic SPA shell signals
    /<link\s[^>]*rel="apple-touch-icon"/i.test(sample) && (sample.match(/apple-touch-icon/gi) ?? []).length >= 3,
    /<div\s+id="(root|app|__next)"[^>]*>\s*<\/div>/i.test(sample),
  ];
  return htmlSignals.filter(Boolean).length >= 3;
}
/** Detect 404/error pages returned as content (common with Jina on non-existent pages) */
export function isErrorPage(content: string): boolean {
  // Strong signals — length-independent. Framework 404 shells ship kilobytes of
  // nav/footer markup, so a length cap can never be a precondition here.
  // Jina Reader responds 200 but prepends this warning when the TARGET errored.
  if (/^Warning:\s*Target URL returned error\s*\d+/im.test(content.slice(0, 2000))) return true;
  // Bare "404"-style heading anywhere plus canonical not-found body text.
  // Real 404 shells never contain code fences — documentation ABOUT not-found
  // handling always does, so a code block clears the page.
  if (
    /^#{1,3}\s*(?:404|page not found|not found)\s*\.?\s*$/im.test(content) &&
    /(?:page|resource) (?:could not be found|not found|doesn.t exist)/i.test(content) &&
    !content.includes("```")
  ) {
    return true;
  }
  // Weak signals — only trusted on thin pages so docs ABOUT 404 handling stay clean.
  const sample = content.slice(0, 1500).toLowerCase();
  return (
    (/page\s*not\s*found|404\s*not\s*found|oops!.*doesn.t\s*exist/i.test(sample) && content.length < 3000) ||
    (/^#\s*(404|page not found|not found)/im.test(sample))
  );
}

/** Detect login/auth walls — content requiring the user to sign in before reading */
export function isLoginWall(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  const signals = [
    /sign\s+in\s+to\s+continue/.test(sample),
    /log\s+in\s+to\s+access/.test(sample),
    /create\s+an\s+account/.test(sample),
    /you\s+must\s+be\s+logged\s+in/.test(sample),
    /authentication\s+required/.test(sample),
    /subscribe\s+to\s+access/.test(sample),
    /premium\s+content/.test(sample),
    /members\s+only/.test(sample),
  ];
  return content.length < 1000 && signals.some(Boolean);
}

/** Detect Cloudflare browser challenges and bot-check pages */
export function isCloudflareChallenge(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  return (
    /checking\s+your\s+browser/.test(sample) ||
    /just\s+a\s+moment/.test(sample) ||
    /ray\s+id/.test(sample) ||
    /enable\s+javascript\s+and\s+cookies/.test(sample) ||
    /attention\s+required/.test(sample) ||
    /cf-browser-verification/.test(sample) ||
    /challenge-platform/.test(sample) ||
    /_cf_chl/.test(sample)
  );
}

/** Detect rate-limit responses masquerading as content */
export function isRateLimitPage(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  return (
    /rate\s+limit\s+exceeded/.test(sample) ||
    /too\s+many\s+requests/.test(sample) ||
    /\b429\b/.test(sample) ||
    /please\s+try\s+again\s+later/.test(sample) ||
    /slow\s+down/.test(sample) ||
    /api\s+rate\s+limit/.test(sample) ||
    /quota\s+exceeded/.test(sample)
  );
}

/** Detect marketing/landing pages that contain no actual documentation */
export function isMarketingPage(content: string): boolean {
  if (content.length < 500) return false;
  const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length;
  if (codeBlocks >= 1) return false;
  const sample = content.slice(0, 5000).toLowerCase();
  const signals = [
    /start\s+(your\s+)?free\s+trial/.test(sample),
    /book\s+a\s+demo/.test(sample),
    /trusted\s+by/.test(sample),
    /customer\s+stories/.test(sample),
    /enterprise\s+plan/.test(sample),
    /\bpricing\b/.test(sample),
  ];
  return signals.filter(Boolean).length >= 2;
}

/** Detect SPA shells that have not rendered any meaningful content */
export function isEmptySPAShell(content: string): boolean {
  const sample = content.slice(0, 5000);
  const sampleLower = sample.toLowerCase();

  const hasSpaRoot =
    /<div\s+id="root"\s*>\s*<\/div>/i.test(sample) ||
    /<div\s+id="app"\s*>\s*<\/div>/i.test(sample);

  const hasLoadingSignal =
    /loading\.\.\./i.test(sampleLower) ||
    /please\s+enable\s+javascript/i.test(sampleLower);

  const textContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const thinText = textContent.length < 100;

  return thinText || hasSpaRoot || hasLoadingSignal;
}

/**
 * Unified content quality gate.
 * Runs all garbage-detection checks in priority order and returns the first hit.
 * Returns `{ garbage: false, reason: "" }` when content is clean.
 */
export function isGarbageContent(content: string): { garbage: boolean; reason: string } {
  if (isEmptySPAShell(content)) return { garbage: true, reason: "empty SPA shell" };
  if (isCloudflareChallenge(content)) return { garbage: true, reason: "Cloudflare challenge" };
  if (isRateLimitPage(content)) return { garbage: true, reason: "rate limit page" };
  if (isLoginWall(content)) return { garbage: true, reason: "login wall" };
  if (isErrorPage(content)) return { garbage: true, reason: "error page" };
  if (isHtmlBlob(content)) return { garbage: true, reason: "HTML blob" };
  if (isMarketingPage(content)) return { garbage: true, reason: "marketing page" };
  return { garbage: false, reason: "" };
}
