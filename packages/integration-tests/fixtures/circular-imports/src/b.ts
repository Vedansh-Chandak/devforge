import { CClass } from "./c.js";

export class BClass {
  c = new CClass();
  
  methodB(): string {
    return "B";
  }
}
