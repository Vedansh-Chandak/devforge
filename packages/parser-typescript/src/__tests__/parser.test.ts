import { describe, it, expect } from "vitest";
import { parseTypeScript } from "../parser.js";

describe("TypeScript Parser", () => {
  it("parses imports", () => {
    const code = `
      import { foo, bar as baz } from "my-module";
      import defaultExport from "default-module";
      import * as ns from "namespace-module";
      import type { TypeOnly } from "types-only";
    `;
    const result = parseTypeScript(code);
    expect(result.imports).toHaveLength(4);
    expect(result.imports[0]?.moduleSpecifier).toBe("my-module");
    expect(result.imports[0]?.namedImports).toHaveLength(2);
    expect(result.imports[1]?.defaultImport).toBe("defaultExport");
    expect(result.imports[2]?.namespaceImport).toBe("ns");
    expect(result.imports[3]?.isTypeOnly).toBe(true);
  });

  it("parses exports", () => {
    const code = `
      export const foo = 1;
      export { bar, baz as qux };
      export { type OnlyType } from "types";
      export default function() {}
      export * from "reexport";
    `;
    const result = parseTypeScript(code);
    expect(result.exports.length).toBeGreaterThan(0);
  });

  it("parses classes", () => {
    const code = `
      export class MyClass<T> extends Base implements Interface {
        private prop: string;
        public readonly staticProp = "value";
        
        constructor(private dep: Dependency) {}
        
        method(): void {}
        async asyncMethod(): Promise<number> { return 42; }
        get getter(): string { return ""; }
        set setter(value: string) {}
      }
    `;
    const result = parseTypeScript(code);
    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls?.name).toBe("MyClass");
    expect(cls?.typeParameters).toHaveLength(1);
    expect(cls?.members.length).toBeGreaterThan(0);
  });

  it("parses interfaces", () => {
    const code = `
      export interface MyInterface<T> extends BaseInterface {
        readonly prop: string;
        optional?: number;
        method(): void;
        (): string;
        new (): object;
        [key: string]: unknown;
      }
    `;
    const result = parseTypeScript(code);
    expect(result.interfaces).toHaveLength(1);
    const iface = result.interfaces[0];
    expect(iface?.name).toBe("MyInterface");
    expect(iface?.members.length).toBeGreaterThan(0);
  });

  it("parses enums", () => {
    const code = `
      enum Direction {
        Up = 1,
        Down,
        Left = "LEFT",
        Right = "RIGHT",
      }
      const enum ConstEnum {
        A = 1,
        B,
      }
    `;
    const result = parseTypeScript(code);
    expect(result.enums).toHaveLength(2);
    expect(result.enums[0]?.name).toBe("Direction");
    expect(result.enums[0]?.members).toHaveLength(4);
    expect(result.enums[1]?.isConst).toBe(true);
  });

  it("parses functions", () => {
    const code = `
      export function regular(a: string, b?: number): boolean { return true; }
      export async function asyncFunc(): Promise<void> {}
      export function* generator(): Generator<number> { yield 1; }
      export const arrow = async (x: number) => x * 2;
    `;
    const result = parseTypeScript(code);
    expect(result.functions).toHaveLength(3); // function declarations only
    expect(result.functions[0]?.name).toBe("regular");
    expect(result.functions[1]?.isAsync).toBe(true);
    expect(result.functions[2]?.isGenerator).toBe(true);
  });

  it("parses type aliases", () => {
    const code = `
      type Simple = string | number;
      type Generic<T> = T | null;
      type Complex<T extends object> = {
        [K in keyof T]: T[K] extends Function ? never : T[K];
      };
    `;
    const result = parseTypeScript(code);
    expect(result.typeAliases).toHaveLength(3);
    expect(result.typeAliases[0]?.name).toBe("Simple");
    expect(result.typeAliases[1]?.typeParameters).toHaveLength(1);
  });

  it("handles empty files", () => {
    const code = "";
    const result = parseTypeScript(code);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.interfaces).toHaveLength(0);
    expect(result.enums).toHaveLength(0);
    expect(result.functions).toHaveLength(0);
    expect(result.typeAliases).toHaveLength(0);
  });

  it("parses nested declarations", () => {
    const code = `
      export class Outer {
        static Inner = class {
          method() {}
        };
      }
      export function outer() {
        function inner() {}
        return inner;
      }
    `;
    const result = parseTypeScript(code);
    expect(result.classes).toHaveLength(1);
    expect(result.functions).toHaveLength(2); // outer and inner
  });

  it("parses generic functions", () => {
    const code = `
      function identity<T>(value: T): T { return value; }
      async function fetchData<T, U extends string>(id: T, key: U): Promise<U> { return key; }
    `;
    const result = parseTypeScript(code);
    expect(result.functions).toHaveLength(2);
    expect(result.functions[0]?.typeParameters).toHaveLength(1);
    expect(result.functions[1]?.typeParameters).toHaveLength(2);
  });

  it("includes source location information", () => {
    const code = `export function test() {}`;
    const result = parseTypeScript(code);
    expect(result.functions[0]?.start).toBeGreaterThanOrEqual(0);
    expect(result.functions[0]?.end).toBeGreaterThan((result.functions[0]?.start) ?? 0);
  });
});