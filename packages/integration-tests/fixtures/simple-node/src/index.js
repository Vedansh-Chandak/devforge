// Simple Node.js module

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

console.log(greet("World"));
console.log(add(2, 3));
console.log(multiply(4, 5));