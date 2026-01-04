import rateLimit from "express-rate-limit";

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 requests
  message: { error: "Too many reset attempts. Try again later." },
});
