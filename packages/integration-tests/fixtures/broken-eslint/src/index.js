// Broken ESLint file with intentional errors

// Error 1: unused variable
var unusedVariable = "I am never used";

// Error 2: console.log in production code
console.log("This should not be in production");

// Error 3: loose equality
if (someValue == null) {
  console.log("Using loose equality");
}

// Error 4: var instead of const/let
var oldStyleVariable = "use const or let";

// Error 5: missing semicolon (if semi rule was enabled, but we focus on above)
const someValue = null;

export function greet(name) {
  return `Hello, ${name}!`;
}