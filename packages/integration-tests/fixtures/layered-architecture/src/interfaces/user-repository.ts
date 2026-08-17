import { User, CreateUserInput } from "../models/user.js";

export interface UserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
}