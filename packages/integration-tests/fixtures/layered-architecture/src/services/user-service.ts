import { User, CreateUserInput } from "../models/user.js";
import { UserRepository } from "../repositories/user-repository.js";

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async getAllUsers(): Promise<User[]> {
    return this.userRepository.findAll();
  }

  async getUserById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async createUser(input: CreateUserInput): Promise<User> {
    return this.userRepository.create(input);
  }
}
