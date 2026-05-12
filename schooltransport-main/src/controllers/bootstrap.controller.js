import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/* =========================
   UTIL
========================= */

const signToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

/* =========================
   CREATE SYSTEM ADMIN
   (ONLY ONCE EVER)
========================= */

export const bootstrapAdmin = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findFirst({
      where: { role: "SYSTEM_ADMIN" },
    });

    if (existing) {
      return res.status(403).json({
        message: "System admin already exists",
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: "SYSTEM_ADMIN",
        tenantId: null,
      },
    });

    const token = signToken(admin);

    return res.status(201).json({
      message: "System admin created successfully",
      token,
      user: admin,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to bootstrap admin" });
  }
};

/* =========================
   CREATE AGENT (ADMIN ONLY)
========================= */

export const bootstrapAgent = async (req, res) => {
  try {
    const admin = req.user;

    if (admin.role !== "SYSTEM_ADMIN") {
      return res.status(403).json({
        message: "Only SYSTEM_ADMIN can create agents",
      });
    }

    const { name, email, password, commissionRate } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: "AGENT",
        tenantId: null,
      },
    });

    const agent = await prisma.agent.create({
      data: {
        userId: user.id,
        commissionRate: commissionRate || 0.1,
      },
    });

    await prisma.agentWallet.create({
      data: {
        agentId: agent.id,
        balance: 0,
      },
    });

    return res.status(201).json({
      message: "Agent created successfully",
      agent,
      user,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to create agent" });
  }
};