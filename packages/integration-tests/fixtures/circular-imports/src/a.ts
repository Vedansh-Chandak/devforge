import { BClass } from "./b.js";

export class AClass {
  b = new BClass();
  
  methodA(): string {
    return "A";
  }
}
