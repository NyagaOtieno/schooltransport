import prisma from "../middleware/prisma.js";
import bcrypt from "bcryptjs";

// ------------------ Get All Users ------------------
export const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({ include: { school: true } });
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

// ------------------ Get Single User ------------------
export const getUser = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

// ------------------ Create User ------------------
export const createUser = async (req, res) => {
  try {
    const { password, ...rest } = req.body;

    // Hash password before saving
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const user = await prisma.user.create({
      data: { ...rest, password: hashedPassword },
    });

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

// ------------------ Update User ------------------
export const updateUser = async (req, res) => {
  try {
    const { password, ...rest } = req.body;
    let dataToUpdate = { ...rest };

    // Re-hash password if provided during update
    if (password) {
      dataToUpdate.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: dataToUpdate,
    });

    res.status(200).json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

// ------------------ Delete User ------------------
export const deleteUser = async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};
