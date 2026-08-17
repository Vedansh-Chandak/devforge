import { AClass } from "./a.js";

export class CClass {
  a = new AClass();
  
  methodC(): string {
    return "C";
  }
}
