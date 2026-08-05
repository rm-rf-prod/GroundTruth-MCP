import { describe, it, expect } from "vitest";
import { AUDIT_PATTERNS, buildCommentMap } from "./audit.js";

// Helper: run all patterns of a given category against a single line
function testLine(category: string, line: string): string[] {
  return AUDIT_PATTERNS
    .filter((p) => p.category === category)
    .filter((p) => p.test(line, line, 0, [line], 0) !== null)
    .map((p) => p.title);
}

// Helper: check a specific pattern by title
function matchesPattern(title: string, line: string, context?: string[]): boolean {
  const pattern = AUDIT_PATTERNS.find((p) => p.title === title);
  if (!pattern) throw new Error(`Pattern not found: ${title}`);
  const lines = context ?? [line];
  const idx = lines.indexOf(line);
  return pattern.test(line, lines.join("\n"), 0, lines, idx === -1 ? 0 : idx) !== null;
}

// ── buildCommentMap ───────────────────────────────────────────────────────────

describe("Python audit patterns", () => {
  describe("SQL injection via f-string", () => {
    it("flags cursor.execute with f-string", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")`,
      )).toBe(true);
    });

    it("flags cursor.execute with .format()", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute("SELECT * FROM users WHERE id = {}".format(user_id))`,
      )).toBe(true);
    });

    it("does not flag parameterized query", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`,
      )).toBe(false);
    });
  });

  describe("eval() / exec()", () => {
    it("flags eval()", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `result = eval(user_input)`)).toBe(true);
    });

    it("flags exec()", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `exec(code_string)`)).toBe(true);
    });

    it("does not flag 'executive' as a false positive", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `# executive summary`)).toBe(false);
    });
  });

  describe("subprocess shell=True", () => {
    it("flags subprocess.run with shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.run(cmd, shell=True)`,
      )).toBe(true);
    });

    it("flags subprocess.call with shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.call(["ls"], shell=True)`,
      )).toBe(true);
    });

    it("does not flag subprocess.run without shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.run(["ls", "-la"], check=True)`,
      )).toBe(false);
    });
  });

  describe("os.system()", () => {
    it("flags os.system() call", () => {
      expect(matchesPattern("os.system() call — command injection risk", `os.system("ls " + user_dir)`)).toBe(true);
    });

    it("does not flag os.path.exists()", () => {
      expect(matchesPattern("os.system() call — command injection risk", `os.path.exists(filepath)`)).toBe(false);
    });
  });

  describe("bare except", () => {
    it("flags bare except:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except:`)).toBe(true);
    });

    it("does not flag except Exception as e:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except Exception as e:`)).toBe(false);
    });

    it("does not flag except ValueError:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except ValueError:`)).toBe(false);
    });
  });

  describe("pickle.loads()", () => {
    it("flags pickle.loads()", () => {
      expect(matchesPattern("pickle.loads() from untrusted source", `data = pickle.loads(raw_bytes)`)).toBe(true);
    });

    it("flags pickle.load()", () => {
      expect(matchesPattern("pickle.loads() from untrusted source", `obj = pickle.load(f)`)).toBe(true);
    });
  });

  describe("MD5/SHA1 for passwords", () => {
    it("flags hashlib.md5()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `hashed = hashlib.md5(password.encode()).hexdigest()`,
      )).toBe(true);
    });

    it("flags hashlib.sha1()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `h = hashlib.sha1(data)`,
      )).toBe(true);
    });

    it("does not flag hashlib.sha256()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `h = hashlib.sha256(data)`,
      )).toBe(false);
    });
  });

  describe("requests verify=False", () => {
    it("flags requests.get with verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.get(url, verify=False)`,
      )).toBe(true);
    });

    it("flags requests.post with verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.post(url, json=body, verify=False)`,
      )).toBe(true);
    });

    it("does not flag requests.get without verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.get(url, timeout=10)`,
      )).toBe(false);
    });
  });

  describe("mutable default argument", () => {
    it("flags def with list default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def process(items=[]):`,
      )).toBe(true);
    });

    it("flags def with dict default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def build(config={}):`,
      )).toBe(true);
    });

    it("does not flag def with None default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def process(items=None):`,
      )).toBe(false);
    });

    it("does not flag def with string default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def greet(name="world"):`,
      )).toBe(false);
    });
  });

});
