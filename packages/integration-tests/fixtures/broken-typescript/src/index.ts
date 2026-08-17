// Broken TypeScript file with intentional errors

// Error 1: Cannot find name 'unknownFunction'
unknownFunction();

// Error 2: Type mismatch
const myNumber: number = "this is a string";

// Error 3: Property does not exist
const obj = { foo: "bar" };
obj.nonexistent = 123;

// Error 4: Missing return type in function (with noImplicitAny)
function add(a, b) {
  return a + b;
}

// Error 5: Unused variable (with noUnusedLocals)
const unusedVariable = "I am never used";

export function greet(name: string): string {
  return `Hello, ${name}!`;
}