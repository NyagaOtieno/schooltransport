import prisma from "../../middleware/prisma.js";
import { createLedgerEntry } from "./ledger.service.js";

export class BillingEngine {
  /**
   * Resolve wallet safely (parent OR client)
   */
  static async getWallet({ parentId, clientId }, tx = prisma) {
    const wallet = await tx.wallet.findFirst({
      where: {
        OR: [
          parentId ? { parentId } : null,
          clientId ? { clientId } : null,
        ].filter(Boolean),
      },
    });

    if (wallet) return wallet;

    return await tx.wallet.create({
      data: {
        parentId,
        clientId,
        balance: 0,
      },
    });
  }

  /**
   * CREDIT WALLET (TOPUP)
   */
  static async credit({ parentId, clientId, amount, reference }) {
    return await prisma.$transaction(async (tx) => {
      const wallet = await this.getWallet({ parentId, clientId }, tx);

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });

      await createLedgerEntry({
        tx,
        walletId: wallet.id,
        parentId,
        clientId,
        type: "CREDIT",
        amount,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance + amount,
        reference,
      });

      return updated;
    });
  }

  /**
   * DEBIT WALLET (SAFETY LOCKED)
   */
  static async debit({ parentId, clientId, amount, reference }) {
    return await prisma.$transaction(async (tx) => {
      const wallet = await this.getWallet({ parentId, clientId }, tx);

      if (!wallet) {
        const err = new Error("Wallet not found");
        err.code = "WALLET_NOT_FOUND";
        throw err;
      }

      if (wallet.balance < amount) {
        const err = new Error("Insufficient balance");
        err.code = "INSUFFICIENT_FUNDS";
        err.currentBalance = wallet.balance;
        throw err;
      }

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      await createLedgerEntry({
        tx,
        walletId: wallet.id,
        parentId,
        clientId,
        type: "DEBIT",
        amount,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance - amount,
        reference,
      });

      return updated;
    });
  }

  /**
   * BALANCE
   */
  static async balance({ parentId, clientId }) {
    const wallet = await this.getWallet({ parentId, clientId });
    return wallet.balance;
  }
}