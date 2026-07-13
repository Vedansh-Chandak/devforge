import { Request, Response } from "express";
import { UserService } from "../services/user-service.js";
import { CreateUserInput } from "../models/user.js";

export class UserController {
  constructor(private readonly userService: UserService) {}

  async getAll(req: Request, res: Response): Promise<void> {
    const users = await this.userService.getAllUsers();
    res.json(users);
  }

  async getById(req: Request, res: Response): Promise<void> {
    const user = await this.userService.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  }

  async create(req: Request, res: Response): Promise<void> {
    const input: CreateUserInput = req.body;
    const user = await this.userService.createUser(input);
    res.status(201).json(user);
  }
}
