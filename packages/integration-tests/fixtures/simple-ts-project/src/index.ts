import { Calculator } from "./math.js";
import { calculateExpression } from "./utils.js";

const calc = new Calculator();

console.log("Add:", calc.add(2, 3));
console.log("Multiply:", calc.multiply(4, 5));
console.log("Expression:", calculateExpression(2, 3, 4));

export { Calculator, calculateExpression };