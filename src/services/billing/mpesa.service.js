// src/services/billing/mpesa.service.js
// Daraja API — STK Push (C2B Express) · C2B Paybill · B2C · B2B
import axios from "axios";

/* ============================================================
   CONFIG
============================================================ */
const IS_SANDBOX    = process.env.MPESA_ENV !== "production";
const BASE_URL      = IS_SANDBOX
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;

// STK Push (Lipa na M-Pesa) — parent wallet top-up
const STK_SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY       = process.env.MPESA_PASSKEY;

// C2B Paybill — parent pays via M-Pesa menu
const C2B_SHORTCODE = process.env.MPESA_C2B_SHORTCODE || process.env.MPESA_SHORTCODE;

// B2C — agent M-Pesa withdrawal
const B2C_SHORTCODE   = process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE;
const B2C_INITIATOR   = process.env.MPESA_B2C_INITIATOR_NAME;
const B2C_CREDENTIAL  = process.env.MPESA_B2C_SECURITY_CREDENTIAL;

// B2B — agent bank transfer (business to bank/till)
const B2B_SHORTCODE   = process.env.MPESA_B2B_SHORTCODE || process.env.MPESA_SHORTCODE;
const B2B_INITIATOR   = process.env.MPESA_B2B_INITIATOR_NAME || process.env.MPESA_B2C_INITIATOR_NAME;
const B2B_CREDENTIAL  = process.env.MPESA_B2B_SECURITY_CREDENTIAL || process.env.MPESA_B2C_SECURITY_CREDENTIAL;

const CALLBACK_BASE   = process.env.MPESA_CALLBACK_BASE_URL;

/* ============================================================
   OAUTH TOKEN — cached, auto-refreshed 30s before expiry
============================================================ */
let _token       = null;
let _tokenExpiry = 0;

export const getAccessToken = async () => {
  if (_token && Date.now() < _tokenExpiry) return _token;

  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be set in environment.");
  }

  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const { data }    = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  _token       = data.access_token;
  _tokenExpiry = Date.now() + (Number(data.expires_in) - 30) * 1000;
  return _token;
};

/* ============================================================
   HELPERS
============================================================ */

/** Timestamp in Daraja format: YYYYMMDDHHmmss */
export const mpesaTimestamp = () => {
  const d   = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
};

/** STK password = Base64(shortcode + passkey + timestamp) */
export const buildStkPassword = (ts) =>
  Buffer.from(`${STK_SHORTCODE}${PASSKEY}${ts}`).toString("base64");

/**
 * Normalize Kenyan phone to 2547XXXXXXXX format.
 * Accepts: 0712345678 | +254712345678 | 712345678 | 254712345678
 */
export const normalizePhone = (phone) => {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0")   && digits.length === 10) return "254" + digits.slice(1);
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return "254" + digits;
  return digits;
};

/* ============================================================
   1. STK PUSH — Lipa na M-Pesa Online (C2B Express)
   Parent initiates top-up → phone receives PIN prompt.
   Callback: POST /api/mpesa/stk-callback
============================================================ */
export const initiateSTKPush = async ({
  phone,
  amount,
  accountRef,
  description = "Wallet Top Up",
}) => {
  const token = await getAccessToken();
  const ts    = mpesaTimestamp();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: STK_SHORTCODE,
      Password:          buildStkPassword(ts),
      Timestamp:         ts,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(amount),
      PartyA:            normalizePhone(phone),
      PartyB:            STK_SHORTCODE,
      PhoneNumber:       normalizePhone(phone),
      CallBackURL:       `${CALLBACK_BASE}/api/mpesa/stk-callback`,
      AccountReference:  String(accountRef).slice(0, 12),
      TransactionDesc:   String(description).slice(0, 100),
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
  // Returns: { ResponseCode, ResponseDescription, MerchantRequestID,
  //            CheckoutRequestID, CustomerMessage }
};

/* ============================================================
   2. STK PUSH STATUS QUERY
   Poll Daraja directly (complements our DB polling).
============================================================ */
export const querySTKStatus = async (checkoutRequestId) => {
  const token = await getAccessToken();
  const ts    = mpesaTimestamp();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: STK_SHORTCODE,
      Password:          buildStkPassword(ts),
      Timestamp:         ts,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
  // Returns: { ResponseCode, ResultCode, ResultDesc }
};

/* ============================================================
   3. C2B — REGISTER PAYBILL CALLBACK URLS
   One-time setup. Tells Safaricom where to send payment events.
   ResponseType:
     "Completed"  → auto-accept all payments (skip validation)
     "Cancelled"  → reject if validation URL is down
============================================================ */
export const registerC2BUrls = async (responseType = "Completed") => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/c2b/v2/registerurl`,
    {
      ShortCode:       C2B_SHORTCODE,
      ResponseType:    responseType,
      ConfirmationURL: `${CALLBACK_BASE}/api/mpesa/c2b/confirm`,
      ValidationURL:   `${CALLBACK_BASE}/api/mpesa/c2b/validate`,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   4. C2B — SIMULATE PAYMENT (sandbox only)
   Simulates a parent paying via M-Pesa menu → paybill number.
   BillRefNumber should be "TRK{userId}" (e.g. "TRK42").
============================================================ */

export const simulateC2B = async ({ phone, amount, billRef = "TEST" }) => {
  const token = await getAccessToken();
 if (!IS_SANDBOX) {
   throw new Error("C2B simulation is only available in sandbox");
}
  const { data } = await axios.post(
    `${BASE_URL}/mpesa/c2b/v1/simulate`,
    {
      ShortCode:     C2B_SHORTCODE,
      CommandID:     "CustomerPayBillOnline",
      Amount:        Math.ceil(amount),
      Msisdn:        normalizePhone(phone),
      BillRefNumber: String(billRef).slice(0, 20),
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   5. B2C — BUSINESS TO CUSTOMER (agent M-Pesa withdrawal)
   Sends money directly to agent's M-Pesa number.
   No PIN required from recipient — instant delivery.
   Callback: POST /api/mpesa/b2c/callback
   Timeout:  POST /api/mpesa/b2c/timeout
============================================================ */
export const initiateB2C = async ({
  phone,
  amount,
  remarks  = "Agent Withdrawal",
  occasion = "Withdrawal",
}) => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName:      B2C_INITIATOR,
      SecurityCredential: B2C_CREDENTIAL,
      CommandID:          "BusinessPayment",   // instant, no approval
      Amount:             Math.ceil(amount),
      PartyA:             B2C_SHORTCODE,
      PartyB:             normalizePhone(phone),
      Remarks:            remarks,
      QueueTimeOutURL:    `${CALLBACK_BASE}/api/mpesa/b2c/timeout`,
      ResultURL:          `${CALLBACK_BASE}/api/mpesa/b2c/callback`,
      Occasion:           occasion,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
  // Returns: { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }
};

/* ============================================================
   6. B2B — BUSINESS TO BUSINESS (agent bank transfer)
   Sends money from M-Pesa business account to another shortcode
   or bank account registered on M-Pesa.

   CommandID options:
     "BusinessPayBill"     → to another paybill
     "BusinessBuyGoods"    → to till number
     "MerchantToMerchant"  → merchant-to-merchant

   SenderIdentifierType / ReceiverIdentifierType:
     1 = MSISDN  4 = Organisation ShortCode  2 = Till Number

   Callback: POST /api/mpesa/b2b/callback
   Timeout:  POST /api/mpesa/b2b/timeout
============================================================ */
export const initiateB2B = async ({
  receiverShortcode,
  amount,
  commandId         = "BusinessPayBill",
  senderIdentifier  = "4",   // our shortcode type
  receiverIdentifier = "4",  // destination shortcode type
  remarks           = "Agent Bank Transfer",
  occasion          = "BankTransfer",
  accountRef        = "",    // bank account number if going to bank
}) => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/b2b/v1/paymentrequest`,
    {
      Initiator:               B2B_INITIATOR,
      SecurityCredential:      B2B_CREDENTIAL,
      CommandID:               commandId,
      SenderIdentifierType:    senderIdentifier,
      ReceiverIdentifierType: receiverIdentifier,
      Amount:                  Math.ceil(amount),
      PartyA:                  B2B_SHORTCODE,
      PartyB:                  String(receiverShortcode),
      AccountReference:        accountRef,
      Remarks:                 remarks,
      QueueTimeOutURL:         `${CALLBACK_BASE}/api/mpesa/b2b/timeout`,
      ResultURL:               `${CALLBACK_BASE}/api/mpesa/b2b/callback`,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
  // Returns: { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }
};

export const queryTransactionStatus = async ({
   transactionId,
   identifierType = 4
}) => {
   const token = await getAccessToken();

   return axios.post(
      `${BASE_URL}/mpesa/transactionstatus/v1/query`,
      {
         Initiator: B2C_INITIATOR,
         SecurityCredential: B2C_CREDENTIAL,
         CommandID: "TransactionStatusQuery",
         TransactionID: transactionId,
         PartyA: B2C_SHORTCODE,
         IdentifierType: identifierType,
         ResultURL: `${CALLBACK_BASE}/api/mpesa/status/callback`,
         QueueTimeOutURL: `${CALLBACK_BASE}/api/mpesa/status/timeout`,
         Remarks: "Status Query",
         Occasion: ""
      },
      {
         headers: {
            Authorization: `Bearer ${token}`
         }
      }
   );
};