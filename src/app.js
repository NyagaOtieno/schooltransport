import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import schoolRoutes from "./routes/schoolRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import assistantRoutes from "./routes/assistantRoutes.js";
import manifestRoutes from "./routes/manifestRoutes.js";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/parents", parentRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/assistants", assistantRoutes);
app.use("/api/manifests", manifestRoutes);

// Health check route
app.get("/", (req, res) => {
  res.json({ message: "API is running 🚀" });
});

export default app;
