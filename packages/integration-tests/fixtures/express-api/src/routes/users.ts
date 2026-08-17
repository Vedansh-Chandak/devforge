import { Router, type Request, type Response } from "express";
import { UserController } from "../controllers/user-controller.js";
import { UserService } from "../services/user-service.js";

const router = Router();
const userService = new UserService();
const userController = new UserController(userService);

router.post("/", (req: Request, res: Response) => userController.create(req, res));
router.get("/", (req: Request, res: Response) => userController.getAll(req, res));
router.get("/:id", (req: Request, res: Response) => userController.getById(req, res));

export default router;