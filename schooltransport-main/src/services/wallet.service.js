import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getOrCreateWallet = async (userId) => {
  let wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        userId,
        balance: 0,
      },
    });
  }

  return wallet;
};

export const creditWallet = async (userId, amount, description = "Top-up") => {
  if (!amount || amount <= 0) {
    throw new Error("Credit amount must be greater than zero.");
  }

  const wallet = await getOrCreateWallet(userId);

  const [updatedWallet] = await prisma.$transaction([
    prisma.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    }),
    prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: "CREDIT",
        amount,
        description,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance + amount,
      },
    }),
  ]);

  return updatedWallet;
};

export const deductWallet = async (userId, amount, description = "Deduction") => {
  if (!amount || amount <= 0) {
    throw new Error("Deduction amount must be greater than zero.");
  }

  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      const err = new Error("Wallet not found. Please top up your wallet first.");
      err.code = "WALLET_NOT_FOUND";
      throw err;
    }

    if (wallet.balance < amount) {
      const err = new Error("Insufficient wallet balance. Please top up to continue.");
      err.code = "INSUFFICIENT_BALANCE";
      err.currentBalance = wallet.balance;
      throw err;
    }

    const updatedWallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "DEBIT",
        amount,
        description,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance - amount,
      },
    });

    return updatedWallet;
  });
};

export const getBalance = async (userId) => {
  return await getOrCreateWallet(userId);
};