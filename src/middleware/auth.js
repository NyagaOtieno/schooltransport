// src/middleware/auth.js
import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization || req.headers.Authorization;
  const token =
    typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice(7)
      : null;

  if (!token) return res.status(401).json({ error: "Unauthorized. Token required." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ normalize IDs
    const rawUserId = decoded.userId ?? decoded.id ?? decoded.user?.id;
    const rawTenantId =
      decoded.tenantId ??
      decoded.TenantId ??
      decoded.schoolId ?? // backward compatibility
      decoded.school?.id;

    const userId = rawUserId !== undefined && rawUserId !== null ? Number(rawUserId) : null;
    const tenantId = rawTenantId !== undefined && rawTenantId !== null ? Number(rawTenantId) : null;

    req.user = {
      ...decoded,
      userId,
      id: userId, // ✅ keep compatibility with routes using req.user.id
      tenantId,
      role: decoded.role ? String(decoded.role).toUpperCase() : null,
    };

    if (!req.user.userId) return res.status(401).json({ error: "Unauthorized: token missing userId" });

    return next();
  } catch {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};
