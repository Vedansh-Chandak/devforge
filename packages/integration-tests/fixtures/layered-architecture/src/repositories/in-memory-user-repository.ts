import { User, CreateUserInput } from "../models/user.js";
import { UserRepository } from "./user-repository.js";

export class InMemoryUserRepository implements UserRepository {
  private users: Map<string, User> = new Map();
  private idCounter = 0;

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const id = String(++this.idCounter);
    const user: User = {
      id,
      ...input,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }
}
