import axios from "axios";

const MPESA_BASE_URL = "https://sandbox.safaricom.co.ke"; // production later

export const stkPush = async ({ phone, amount, reference }) => {
  try {
    // STEP 1: Get token (simplified placeholder)
    const token = process.env.MPESA_TOKEN;

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: process.env.MPESA_PASSWORD,
        Timestamp: new Date().toISOString(),
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: reference,
        TransactionDesc: "Wallet Top-up",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (err) {
    console.error("[MPESA STK PUSH ERROR]", err.response?.data || err.message);
    throw new Error("M-Pesa STK push failed");
  }
};