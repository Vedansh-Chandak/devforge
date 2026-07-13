import {
  scanRepository,
  RepositoryScanError,
} from "../src/index.js";
import type { RepositoryTree } from "../src/index.js";

interface Scenario {
  name: string;
  root: string;
  expect: "ok" | "throw";
  expectCode?: string;
}

const scenarios: ReadonlyArray<Scenario> = [
  { name: "1. empty directory", root: "/tmp/df-empty", expect: "ok" },
  {
    name: "2. nested repository (DevForge root)",
    root: "/Users/vedanshchandak/Desktop/devforge",
    expect: "ok",
  },
  {
    name: "3. nested folders + files",
    root: "/tmp/df-nested",
    expect: "ok",
  },
  {
    name: "4. non-existent path",
    root: "/tmp/definitely-not-here-df-zzz",
    expect: "throw",
    expectCode: "NOT_FOUND",
  },
  {
    name: "5. root is a file",
    root: "/tmp/df-pr2-fixture/README.md",
    expect: "throw",
    expectCode: "NOT_A_DIRECTORY",
  },
  {
    name: "6. root is a symlink",
    root: "/tmp/root-symlink",
    expect: "throw",
    expectCode: "INVALID_ROOT",
  },
  {
    name: "7. broken symlink inside tree",
    root: "/tmp/df-pr2-fixture",
    expect: "ok",
  },
  {
    name: "8. file without extension",
    root: "/tmp/df-pr2-fixture",
    expect: "ok",
  },
  {
    name: "9. dotfile (.env)",
    root: "/tmp/df-pr2-fixture",
    expect: "ok",
  },
  {
    name: "10. symlink to file inside tree",
    root: "/tmp/df-pr2-fixture",
    expect: "ok",
  },
  {
    name: "11. symlink to directory inside tree",
    root: "/tmp/df-pr2-fixture",
    expect: "ok",
  },
];

async function run(): Promise<void> {
  for (const s of scenarios) {
    try {
      const tree = await scanRepository(s.root);
      const summary = okSummary(tree);
      console.log(`✅ ${s.name}: ${summary}`);
      if (s.expect === "throw") {
        console.error(`   ❌ expected throw, got ok`);
        process.exitCode = 1;
      }
    } catch (err) {
      if (err instanceof RepositoryScanError) {
        console.log(
          `✅ ${s.name}: threw RepositoryScanError(code=${err.code}, rootPath=${err.rootPath})`,
        );
        if (s.expect !== "throw") {
          console.error(`   ❌ expected ok, got throw`);
          process.exitCode = 1;
        } else if (s.expectCode && err.code !== s.expectCode) {
          console.error(
            `   ❌ expected code=${s.expectCode}, got code=${err.code}`,
          );
          process.exitCode = 1;
        }
      } else {
        console.error(`❌ ${s.name}: unexpected non-typed error`);
        console.error(err);
        process.exitCode = 1;
      }
    }
  }
}

function okSummary(tree: RepositoryTree): string {
  const dotfile = findNode(tree, (n) => n.type === "file" && (n.name === ".env" || n.name === ".gitignore"));
  const ext =
    dotfile && dotfile.type === "file"
      ? JSON.stringify(dotfile.extension)
      : "(no dotfile fixture)";
  return `totalNodes=${tree.totalNodes}, root.children=${tree.root.children.length}, sample-dotfile-extension=${ext}`;
}

function findNode(
  tree: RepositoryTree,
  pred: (n: import("../src/index.js").RepositoryNode) => boolean,
): import("../src/index.js").RepositoryNode | null {
  function go(
    n: import("../src/index.js").RepositoryNode,
  ): import("../src/index.js").RepositoryNode | null {
    if (pred(n)) return n;
    if (n.type === "directory") {
      for (const c of n.children) {
        const r = go(c);
        if (r) return r;
      }
    }
    return null;
  }
  return go(tree.root);
}

void run();
