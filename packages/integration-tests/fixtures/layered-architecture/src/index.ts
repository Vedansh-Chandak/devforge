import express, { Application } from "express";
import { InMemoryUserRepository } from "./repositories/in-memory-user-repository.js";
import { UserService } from "./services/user-service.js";
import { UserController } from "./controllers/user-controller.js";

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  const userRepository = new InMemoryUserRepository();
  const userService = new UserService(userRepository);
  const userController = new UserController(userService);

  app.get("/api/users", (req, res) => userController.getAll(req, res));
  app.get("/api/users/:id", (req, res) => userController.getById(req, res));
  app.post("/api/users", (req, res) => userController.create(req, res));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  return app;
}

const app = createApp();
const PORT = process.env.PORT ?? 3000;

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => console.log(`Server on port ${PORT}`));
}

export { app };
