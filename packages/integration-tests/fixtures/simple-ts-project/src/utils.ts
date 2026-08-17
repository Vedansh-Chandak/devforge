import { add, multiply } from "./math.js";

export function calculateExpression(a: number, b: number, c: number): number {
  return add(multiply(a, b), c);
}