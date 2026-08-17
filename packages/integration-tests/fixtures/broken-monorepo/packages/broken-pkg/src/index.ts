// Broken TypeScript in monorepo package

// Error 1: Cannot find name
missingFunction();

// Error 2: Type mismatch
const value: string = 123;

// Error 3: Missing return type
function brokenAdd(a, b) {
  return a + b;
}

export function helper(): string {
  return "helper";
}