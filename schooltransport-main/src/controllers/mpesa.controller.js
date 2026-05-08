import { BillingEngine } from "../services/billing/billing.engine.js";

export const mpesaCallback = async (req, res) => {
  try {
    const body = req.body;

    const result = body?.Body?.stkCallback;

    if (result?.ResultCode !== 0) {
      return res.status(200).json({ success: false });
    }

    const metadata = result.CallbackMetadata?.Item || [];

    const amount = metadata.find((x) => x.Name === "Amount")?.Value;
    const phone = metadata.find((x) => x.Name === "PhoneNumber")?.Value;
    const receipt = metadata.find((x) => x.Name === "MpesaReceiptNumber")?.Value;

    // CREDIT WALLET AFTER SUCCESSFUL PAYMENT
    await BillingEngine.credit({
      clientId: null,
      parentId: null,
      amount,
      reference: receipt,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[MPESA CALLBACK ERROR]", err);
    return res.status(500).json({ success: false });
  }
};