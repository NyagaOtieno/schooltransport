import prisma from "../middleware/prisma.js";

/**
 * Get wallet (parent or client)
 */
export const getWallet = async ({ parentId = null, clientId = null }) => {
  const wallet = await prisma.wallet.findFirst({
    where: {
      OR: [
        parentId ? { parentId } : null,
        clientId ? { clientId } : null,
      ].filter(Boolean),
    },
  });

  return wallet ?? { id: null, balance: 0 };
};

/**
 * CREDIT WALLET
 */
export const creditWallet = async ({
  parentId = null,
  clientId = null,
  amount,
  reference,
}) => {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: parentId ? { parentId } : { clientId },
      update: { balance: { increment: amount } },
      create: {
        parentId,
        clientId,
        balance: amount,
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        parentId,
        clientId,
        amount,
        type: "CREDIT",
        status: "SUCCESS",
        reference,
      },
    });

    return wallet;
  });
};

/**
 * DEBIT WALLET (SAFE)
 */
export const deductWallet = async ({
  parentId = null,
  clientId = null,
  amount,
  reference,
}) => {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: {
        OR: [
          parentId ? { parentId } : null,
          clientId ? { clientId } : null,
        ].filter(Boolean),
      },
    });

    if (!wallet) {
      const err = new Error("Wallet not found");
      err.code = "WALLET_NOT_FOUND";
      throw err;
    }

    if (wallet.balance < amount) {
      const err = new Error("Insufficient balance");
      err.code = "INSUFFICIENT_BALANCE";
      err.currentBalance = wallet.balance;
      throw err;
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        parentId,
        clientId,
        amount,
        type: "DEBIT",
        status: "SUCCESS",
        reference,
      },
    });

    return updated;
  });
};

/**
 * BALANCE
 */
export const getBalance = async ({ parentId, clientId }) => {
  const wallet = await getWallet({ parentId, clientId });
  return wallet.balance;
};