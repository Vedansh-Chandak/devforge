import { type Request, type Response } from "express";
import { UserService } from "../services/user-service.js";

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserController {
  constructor(private readonly userService: UserService) {}

  create(req: Request, res: Response): void {
    const { name, email } = req.body;
    const user = this.userService.create({ name, email });
    res.status(201).json(user);
  }

  getAll(_req: Request, res: Response): void {
    const users = this.userService.getAll();
    res.json(users);
  }

  getById(req: Request, res: Response): void {
    const user = this.userService.getById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  }
}