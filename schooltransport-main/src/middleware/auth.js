import jwt from "jsonwebtoken";

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader !== "string") return null;

  const trimmed = authHeader.trim();
  if (!/^Bearer\s+/i.test(trimmed)) return null;

  return trimmed.replace(/^Bearer\s+/i, "").trim() || null;
}

export const authMiddleware = (req, res, next) => {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ error: "Server configuration error." });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized. Bearer token required." });
    }

    const decoded = jwt.verify(token, jwtSecret);

    const rawUserId = decoded.userId ?? decoded.id ?? decoded.user?.id;

    const userId = toNumberOrNull(rawUserId);
    const tenantId = toNumberOrNull(
      decoded.tenantId ?? decoded.TenantId ?? decoded.schoolId ?? decoded.school?.id
    );

    req.user = {
      ...decoded,
      userId,
      id: userId,
      tenantId,
      role: decoded.role ? String(decoded.role).trim().toUpperCase() : null,

      // ✅ IMPORTANT ADDITIONS
      parentId: toNumberOrNull(decoded.parentId),
      clientId: toNumberOrNull(decoded.clientId),
    };

    if (!req.user.userId) {
      return res.status(401).json({ error: "Invalid token userId." });
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(403).json({ error: "Token expired." });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token." });
    }
    return res.status(500).json({ error: "Authentication failed." });
  }
};

export const requireRole = (...allowedRoles) => {
  const normalized = allowedRoles.map(r => String(r).toUpperCase());

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized." });

    if (!req.user.role || !normalized.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden." });
    }

    next();
  };
};