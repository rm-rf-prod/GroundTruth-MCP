/**
 * Conventional locations of migration and upgrade documentation.
 *
 * NOTE: CHANGELOG.md is intentionally excluded — it is a monolithic all-history
 * release log that floods extraction with version-irrelevant entries. Use
 * gt_changelog for release notes instead.
 */
export const MIGRATION_PATHS = [
  "MIGRATION.md",
  "UPGRADING.md",
  "UPGRADE.md",
  "docs/migration.md",
  "docs/MIGRATION.md",
  "docs/upgrading.md",
  "docs/upgrade-guide.md",
];

export const MIGRATION_URL_SUFFIXES = [
  "/docs/migration",
  "/docs/upgrading",
  "/docs/upgrade",
  "/docs/guides/migration",
  "/docs/guides/upgrading",
  "/migration",
  "/upgrade",
];

/** Doc-site path templates that point at a version-specific upgrade guide. */
export function versionDocSuffixes(toVersion: string): string[] {
  const v = toVersion.replace(/^v/, "");
  return [
    `/docs/app/guides/upgrading/version-${v}`,
    `/docs/app/building-your-application/upgrading/version-${v}`,
    `/docs/upgrading/version-${v}`,
    `/docs/guides/upgrade-to-${v}`,
    `/docs/migration/${v}`,
  ];
}
