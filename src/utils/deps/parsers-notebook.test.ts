import { describe, it, expect } from "vitest";
import { parseNotebookDependencies } from "./parsers-notebook.js";

describe("parseNotebookDependencies", () => {
  it("reads pip and conda install lines, stripping flags and version specifiers", () => {
    const deps = parseNotebookDependencies([
      "%pip install -q -U pandas==2.1.0 'numpy>=1.26' scikit-learn[extra]",
      "!pip install --upgrade requests~=2.31 httpx # http client",
      "%conda install -c conda-forge -y scipy=1.11 conda-forge::networkx",
      "!python -m pip install --index-url https://example.org/simple matplotlib",
    ]);
    expect(deps.sort()).toEqual(["httpx", "matplotlib", "networkx", "numpy", "pandas", "requests", "scikit-learn", "scipy"]);
  });

  it("ignores requirement files, paths and URLs on install lines", () => {
    expect(parseNotebookDependencies(["%pip install -r requirements.txt ./local git+https://github.com/a/b.git ."])).toEqual([]);
  });

  it("keeps imports the registry knows by alias", () => {
    const deps = parseNotebookDependencies(["import numpy as np\nimport pandas as pd, matplotlib.pyplot as plt\nfrom sklearn.model_selection import train_test_split\n    import torch"]);
    expect(deps.sort()).toEqual(["matplotlib", "numpy", "pandas", "sklearn", "torch"]);
  });

  it("drops stdlib imports, which the registry only matches by accident", () => {
    const stdlib = "import os\nimport re\nimport json\nimport sys\nfrom pathlib import Path\nfrom typing import List\nimport math, time, logging, io, string";
    expect(parseNotebookDependencies([stdlib])).toEqual([]);
  });

  it("drops local and relative imports and does not read magics as imports", () => {
    expect(parseNotebookDependencies(["from . import helpers\nfrom my_local_module import f\nimport my_local_module", "%load_ext autoreload"])).toEqual([]);
  });

  it("deduplicates across cells", () => {
    expect(parseNotebookDependencies(["import numpy", "%pip install numpy", "from numpy import array"])).toEqual(["numpy"]);
  });
});
