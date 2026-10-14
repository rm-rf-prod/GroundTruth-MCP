import { describe, it, expect } from "vitest";
import { AUDIT_PATTERNS } from "./audit.js";

function matchesPattern(
  title: string,
  line: string,
  context?: string[],
  filePath?: string,
): boolean {
  const pattern = AUDIT_PATTERNS.find((p) => p.title === title);
  if (!pattern) throw new Error(`Pattern not found: ${title}`);
  const lines = context ?? [line];
  const idx = lines.indexOf(line);
  return pattern.test(line, lines.join("\n"), 0, lines, idx === -1 ? 0 : idx, filePath) !== null;
}

describe("DE, DA, DS, and ML audit patterns", () => {
  describe("Machine Learning & Deep Learning", () => {
    it("flags torch.load without weights_only=True or with weights_only=False", () => {
      expect(
        matchesPattern(
          "torch.load() without weights_only=True — arbitrary code execution risk",
          "model = torch.load('checkpoint.pt')",
        ),
      ).toBe(true);
      expect(
        matchesPattern(
          "torch.load() without weights_only=True — arbitrary code execution risk",
          "model = torch.load('checkpoint.pt', weights_only=False)",
        ),
      ).toBe(true);
    });

    it("does not flag torch.load with weights_only=True", () => {
      expect(
        matchesPattern(
          "torch.load() without weights_only=True — arbitrary code execution risk",
          "model = torch.load('checkpoint.pt', weights_only=True)",
        ),
      ).toBe(false);
    });

    it("flags data leakage when fit_transform is called on test/val data", () => {
      expect(
        matchesPattern(
          "Data leakage: fit_transform() or fit() on evaluation/test data",
          "X_test_scaled = scaler.fit_transform(X_test)",
        ),
      ).toBe(true);
      expect(
        matchesPattern(
          "Data leakage: fit_transform() or fit() on evaluation/test data",
          "encoder.fit(val_df)",
        ),
      ).toBe(true);
    });

    it("does not flag fit_transform on training data", () => {
      expect(
        matchesPattern(
          "Data leakage: fit_transform() or fit() on evaluation/test data",
          "X_train_scaled = scaler.fit_transform(X_train)",
        ),
      ).toBe(false);
    });

    it("flags train_test_split without random_state", () => {
      expect(
        matchesPattern(
          "train_test_split() missing random_state — non-reproducible ML split",
          "X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)",
        ),
      ).toBe(true);
    });

    it("does not flag train_test_split with random_state", () => {
      expect(
        matchesPattern(
          "train_test_split() missing random_state — non-reproducible ML split",
          "X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)",
        ),
      ).toBe(false);
    });
  });

  describe("Data Engineering & Analytics", () => {
    it("flags df.iterrows() as an anti-pattern", () => {
      expect(
        matchesPattern(
          "Inefficient DataFrame row iteration via .iterrows()",
          "for idx, row in df.iterrows():",
        ),
      ).toBe(true);
      expect(
        matchesPattern(
          "Inefficient DataFrame row iteration via .iterrows()",
          "for idx, row in sales_df.iterrows():",
        ),
      ).toBe(true);
    });

    it("flags PySpark .collect() in Spark context", () => {
      const sparkCode = [
        "from pyspark.sql import SparkSession",
        "spark = SparkSession.builder.getOrCreate()",
        "rows = df.collect()",
      ];
      expect(
        matchesPattern(
          "PySpark .collect() on distributed DataFrame — Driver OOM risk",
          "rows = df.collect()",
          sparkCode,
        ),
      ).toBe(true);
    });

    it("flags SELECT * in SQL files or query strings", () => {
      expect(
        matchesPattern(
          "SELECT * in analytical or pipeline SQL query",
          "SELECT * FROM raw_events;",
          undefined,
          "models/staging/stg_events.sql",
        ),
      ).toBe(true);
    });

    it("does not flag explicit column selection in SQL", () => {
      expect(
        matchesPattern(
          "SELECT * in analytical or pipeline SQL query",
          "SELECT event_id, user_id, timestamp FROM raw_events;",
          undefined,
          "models/staging/stg_events.sql",
        ),
      ).toBe(false);
    });

    it("flags hardcoded database connection credentials", () => {
      expect(
        matchesPattern(
          "Hardcoded database credentials in connection string",
          "engine = create_engine('postgresql://postgres:s3cr3tPass@db.internal:5432/analytics')",
        ),
      ).toBe(true);
    });

    it("does not flag connection string with environment variables", () => {
      expect(
        matchesPattern(
          "Hardcoded database credentials in connection string",
          "engine = create_engine(os.environ.get('DATABASE_URL'))",
        ),
      ).toBe(false);
    });
  });
});
