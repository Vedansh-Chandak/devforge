# @devforge/parser-typescript

**TypeScript/TSX AST parser extracting imports, exports, classes, interfaces, functions, enums, and type aliases.**

Second stage of the DevForge pipeline. Consumes source code strings and produces a structured `ParseResult` with all declarations and dependencies.

---

## Purpose

- Parse TypeScript and TSX source files using the TypeScript compiler API
- Extract declarations with full location information (start/end, line/character)
- Capture imports/exports with module specifiers, named/default/namespace, type-only flags
- Report syntax errors without throwing

---

## Responsibilities

1. **Parse** — `parseTypeScript(code, filePath)` → `ParseResult`
2. **Extract** — Classes, interfaces, enums, functions, type aliases, imports, exports
3. **Locate** — Every node has `SourceLocation` (start, end, line, character)
4. **Error** — Collect `SyntaxError` array; never throws on parse failure

---

## Public API

```typescript
import { parseTypeScript } from "@devforge/parser-typescript";
import type {
  ParseResult,
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  NamedImport,
  NamedExport,
  TypeParameter,
  HeritageClause,
  ExpressionWithTypeArguments,
  ClassMember,
  InterfaceMember,
  EnumMember,
  Parameter,
  Modifier,
  SyntaxError,
  SourceLocation,
} from "@devforge/parser-typescript";
```

---

## Example Usage

```typescript
import { parseTypeScript } from "@devforge/parser-typescript";
import { readFile } from "node:fs/promises";

const code = await readFile("./src/service.ts", "utf-8");
const result = parseTypeScript(code, "src/service.ts");

// All declarations
console.log(result.classes);       // ClassDeclaration[]
console.log(result.interfaces);    // InterfaceDeclaration[]
console.log(result.enums);         // EnumDeclaration[]
console.log(result.functions);     // FunctionDeclaration[]
console.log(result.typeAliases);   // TypeAliasDeclaration[]

// Dependencies
console.log(result.imports);       // ImportDeclaration[]
console.log(result.exports);       // ExportDeclaration[]

// Errors
if (result.syntaxErrors.length) {
  console.warn("Parse errors:", result.syntaxErrors);
}
```

---

## Output Types

### ParseResult
```typescript
interface ParseResult {
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  classes: ClassDeclaration[];
  interfaces: InterfaceDeclaration[];
  enums: EnumDeclaration[];
  functions: FunctionDeclaration[];
  typeAliases: TypeAliasDeclaration[];
  syntaxErrors: SyntaxError[];
}
```

### ImportDeclaration
```typescript
interface ImportDeclaration {
  moduleSpecifier: string;           // "./utils" | "lodash" | "react"
  namedImports: NamedImport[];       // { name, alias?, isTypeOnly }
  defaultImport?: string;            // "React"
  namespaceImport?: string;          // "* as React"
  isTypeOnly: boolean;               // import type { ... }
  start: number; end: number;        // Byte offsets
}
```

### ExportDeclaration
```typescript
interface ExportDeclaration {
  moduleSpecifier?: string;          // Re-export: export { foo } from "./bar"
  namedExports: NamedExport[];       // { name, alias?, isTypeOnly }
  exportClause?: string;             // Raw export clause text
  isTypeOnly: boolean;
  start: number; end: number;
}
```

### ClassDeclaration
```typescript
interface ClassDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  heritageClauses: HeritageClause[]; // extends/implements
  members: ClassMember[];            // property, method, constructor, accessor
  modifiers: Modifier[];             // public, private, protected, abstract, static, readonly
  start: number; end: number;
}
```

### FunctionDeclaration
```typescript
interface FunctionDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  parameters: Parameter[];
  returnType?: string;
  body?: string;                     // Function body text
  modifiers: Modifier[];
  isAsync: boolean;
  isGenerator: boolean;
  start: number; end: number;
}
```

### TypeAliasDeclaration
```typescript
interface TypeAliasDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  type: string;                      // Full type expression as string
  start: number; end: number;
}
```

### SourceLocation
```typescript
interface SourceLocation {
  start: number;      // Byte offset
  end: number;        // Byte offset
  line: number;       // 1-indexed
  character: number;  // 0-indexed column
}
```

---

## Dependencies

- **Runtime:** `typescript` (peer, uses compiler API)
- **Dev:** `@repo/typescript-config`, `@types/node`, `typescript`, `vitest`, `tsx`

---

## Design Notes

### Parser Implementation
- Uses `ts.createSourceFile` with `ScriptTarget.Latest`, `ModuleKind.ESNext`
- Enables `jsx: ts.JsxKind.React` for TSX support
- Walks AST with `ts.forEachChild` — single pass, O(n) nodes
- Collects syntax errors from `sourceFile.parseDiagnostics`

### Location Tracking
- All positions are **byte offsets** from file start
- Line/character computed via `sourceFile.getLineAndCharacterOfPosition()`
- Enables precise source mapping for downstream tooling

### Type Resolution
- **No type checking** — this is a syntactic parser only
- Types are returned as **strings** (e.g., `"Promise<User>"`, `"User | null"`)
- Heritage clauses preserve `extends` vs `implements` distinction
- Type parameters include constraints and defaults as strings

### Error Handling
- `syntaxErrors` array contains all parse diagnostics
- Parser **never throws** — always returns `ParseResult`
- Downstream consumers decide how to handle errors (skip file, warn, fail)

### Performance
- Single TypeScript program creation per file (no project context)
- Reuses `ts` module — no additional dependencies
- Typical parse time: ~1-5ms per 1k LOC

---

## Testing

```bash
pnpm --filter @devforge/parser-typescript test
```

Tests cover:
- Basic declarations (class, interface, enum, function, type alias)
- Imports/exports (named, default, namespace, type-only, re-exports)
- Modifiers (public, private, protected, static, abstract, readonly)
- Generics (type parameters, constraints, defaults)
- Heritage (extends, implements)
- JSX/TSX parsing
- Syntax error collection
- Location accuracy

---

## Related Packages

| Package | Relationship |
|---------|--------------|
| `@devforge/repository-indexer` | Provides `FileNode` input |
| `@devforge/symbol-graph` | Consumes `ParseResult` → `ParsedFile` |
| `@devforge/knowledge-graph` | Consumes symbol graph |
| `@devforge/benchmark` | Benchmarks parsing stage |
| `@devforge/integration-tests` | End-to-end pipeline test |