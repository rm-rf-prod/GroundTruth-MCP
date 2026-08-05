/**
 * Topic-URL path patterns probed when guessing a documentation page location,
 * grouped by the doc generator that popularised each shape.
 *
 * Data table, not logic — exempt from the 200-line source convention.
 */
export const DEFAULT_URL_PATTERNS = [
    "/docs/{slug}",
    "/docs/guides/{slug}",
    "/docs/api/{slug}",
    "/reference/{slug}",
    "/guide/{slug}",
    "/learn/{slug}",
    "/tutorial/{slug}",
    "/docs/concepts/{slug}",
    "/docs/getting-started/{slug}",
    "/docs/reference/{slug}",
    "/docs/guide/{slug}",
    "/docs/advanced/{slug}",
    "/docs/recipes/{slug}",
    "/docs/how-to/{slug}",
    "/docs/tutorials/{slug}",
    "/api/{slug}",
    "/guides/{slug}",
    "/concepts/{slug}",
    "/examples/{slug}",
    "/cookbook/{slug}",
    // Docusaurus
    "/docs/category/{slug}",
    "/blog/{slug}",
    // GitBook
    "/fundamentals/{slug}",
    // ReadTheDocs
    "/en/latest/{slug}",
    "/en/stable/{slug}",
    // VitePress
    "/{slug}.html",
    // Mintlify
    "/api-reference/{slug}",
    "/quickstart/{slug}",
    // Nextra / Fumadocs
    "/docs/{slug}",
  ];
