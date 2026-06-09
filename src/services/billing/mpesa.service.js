// src/services/billing/mpesa.service.js
import axios from "axios";

/* ============================================================
   CONFIG — all from .env
============================================================ */
const IS_SANDBOX      = process.env.MPESA_ENV !== "production";
const BASE_URL        = IS_SANDBOX
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE       = process.env.MPESA_SHORTCODE;           // STK push paybill/till
const PASSKEY         = process.env.MPESA_PASSKEY;
const C2B_SHORTCODE   = process.env.MPESA_C2B_SHORTCODE || process.env.MPESA_SHORTCODE;
const B2C_SHORTCODE   = process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE;
const B2C_INITIATOR   = process.env.MPESA_B2C_INITIATOR_NAME;
const B2C_CREDENTIAL  = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
const CALLBACK_BASE   = process.env.MPESA_CALLBACK_BASE_URL;   // e.g. https://schooltransport-production.up.railway.app

/* ============================================================
   ACCESS TOKEN — cached, auto-refreshed 30s before expiry
============================================================ */
let _token       = null;
let _tokenExpiry = 0;

export const getAccessToken = async () => {
  if (_token && Date.now() < _tokenExpiry) return _token;

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

/** Daraja timestamp format: YYYYMMDDHHmmss */
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
  Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString("base64");

/**
 * Normalize a Kenyan phone to 2547XXXXXXXX / 2541XXXXXXXX.
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
   STK PUSH (Lipa na M-Pesa Online — business-initiated)
   Flow: backend sends prompt → user enters PIN on their phone
         → Safaricom calls /api/mpesa/callback
============================================================ */

/**
 * @param {{ phone: string, amount: number, accountRef: string, description?: string }}
 * @returns Daraja STK response: { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
 */
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
      BusinessShortCode: SHORTCODE,
      Password:          buildStkPassword(ts),
      Timestamp:         ts,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(amount),        // M-Pesa requires whole KES
      PartyA:            normalizePhone(phone),
      PartyB:            SHORTCODE,
      PhoneNumber:       normalizePhone(phone),
      CallBackURL:       `${CALLBACK_BASE}/stk-callback`,
      AccountReference:  String(accountRef).slice(0, 12),  // max 12 chars
      TransactionDesc:   String(description).slice(0, 13), // max 13 chars
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   STK STATUS QUERY
   Poll Daraja directly (optional — we also poll our own DB)
============================================================ */
export const querySTKStatus = async (checkoutRequestId) => {
  const token = await getAccessToken();
  const ts    = mpesaTimestamp();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: SHORTCODE,
      Password:          buildStkPassword(ts),
      Timestamp:         ts,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   C2B — REGISTER URLS (run once per shortcode, or on startup)
   Tells Safaricom where to send validation + confirmation.

   ValidationURL  → called BEFORE payment is processed (optional)
   ConfirmationURL → called AFTER payment succeeds (required)

   ResponseType:
     "Completed"  = auto-accept all payments (skip validation)
     "Cancelled"  = auto-reject if validation URL is down
============================================================ */
export const registerC2BUrls = async (responseType = "Completed") => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/c2b/v1/registerurl`,
    {
      ShortCode:       C2B_SHORTCODE,
      ResponseType:    responseType,
     ConfirmationURL: `${CALLBACK_BASE}c2b/confirmation`,
     ValidationURL: `${CALLBACK_BASE}/c2b/validation`
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   C2B — SIMULATE (sandbox testing only)
   Simulates a customer paying via M-Pesa menu (paybill).
   CommandID: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline"
============================================================ */
export const simulateC2B = async ({ phone, amount, billRef = "TEST" }) => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/c2b/v1/simulate`,
    {
      ShortCode:     C2B_SHORTCODE,
      CommandID:     "CustomerPayBillOnline",
      Amount:        Math.ceil(amount),
      Msisdn:        normalizePhone(phone),
      BillRefNumber: String(billRef).slice(0, 20),  // account reference / TRK-userId
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   B2C — AGENT WITHDRAWAL
   Business sends money to agent's M-Pesa number.
============================================================ */
export const initiateB2C = async ({
  phone,
  amount,
  remarks  = "Agent Withdrawal",
  occasion = "Withdrawal",
}) => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,  // v1 matches Postman collection
    {
      InitiatorName:      B2C_INITIATOR,
      SecurityCredential: B2C_CREDENTIAL,
      CommandID:          "BusinessPayment",
      Amount:             Math.ceil(amount),
      PartyA:             B2C_SHORTCODE,
      PartyB:             normalizePhone(phone),
      Remarks:            remarks,
      QueueTimeOutURL:    `${CALLBACK_BASE}/b2c/timeout`,
      ResultURL:          `${CALLBACK_BASE}/b2c/callback`,
      Occasion:           occasion,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};