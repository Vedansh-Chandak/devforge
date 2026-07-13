import userRoutes from "./routes/users.js";

import { app } from "./app.js";

app.use("/api/users", userRoutes);

export { app };