import { type User } from "../controllers/user-controller.js";

export class UserService {
  private users: Map<string, User> = new Map();
  private idCounter = 0;

  create(input: { name: string; email: string }): User {
    const id = String(++this.idCounter);
    const user: User = { id, ...input };
    this.users.set(id, user);
    return user;
  }

  getAll(): User[] {
    return Array.from(this.users.values());
  }

  getById(id: string): User | undefined {
    return this.users.get(id);
  }
}