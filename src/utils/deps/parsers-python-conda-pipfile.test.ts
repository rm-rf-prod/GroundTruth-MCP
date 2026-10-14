import { describe, it, expect } from "vitest";
import { parseCondaYaml, parsePipfile } from "./parsers-python.js";

describe("parseCondaYaml", () => {
  it("extracts packages from standard environment.yml", () => {
    const yaml = `
name: ml-env
channels:
  - conda-forge
  - defaults
dependencies:
  - python=3.11
  - numpy>=1.24
  - pandas==2.2.0
  - scikit-learn
  - pytorch::torchvision
  - pip
  - pip:
    - transformers>=4.38
    - datasets
`;
    const deps = parseCondaYaml(yaml);
    expect(deps).toContain("numpy");
    expect(deps).toContain("pandas");
    expect(deps).toContain("scikit-learn");
    expect(deps).toContain("pytorch::torchvision");
    expect(deps).toContain("transformers");
    expect(deps).toContain("datasets");
    expect(deps).not.toContain("python");
    expect(deps).not.toContain("pip");
  });
});

describe("parsePipfile", () => {
  it("extracts packages from packages and dev-packages sections", () => {
    const pipfile = `
[[source]]
url = "https://pypi.org/simple"
verify_ssl = true
name = "pypi"

[packages]
requests = "*"
flask = ">=2.0"
pandas = {version = "*", extras = ["performance"]}
scikit-learn = "*"

[dev-packages]
pytest = ">=7.0"
black = "*"
`;
    const deps = parsePipfile(pipfile);
    expect(deps).toEqual(["requests", "flask", "pandas", "scikit-learn", "pytest", "black"]);
  });
});
