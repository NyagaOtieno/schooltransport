import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req, res) => {
    // Prefer email-based limiting
    if (req.body?.email) {
      return `email:${req.body.email.toLowerCase()}`;
    }

    // Fallback to normalized IP (IPv4 + IPv6 safe)
    return ipKeyGenerator(req, res);
  },

  handler: (req, res) => {
    res.status(429).json({
      error: "Too many password reset attempts. Please try again later.",
    });
  },
});
