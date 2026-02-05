// src/middleware/auth.js
import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized. Token required." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ normalize for code consistency
    decoded.id = decoded.id || decoded.userId; // ensures req.user.id works
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};
