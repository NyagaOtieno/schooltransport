// src/services/billing/mpesa.service.js
import axios from "axios";

const IS_SANDBOX  = process.env.MPESA_ENV !== "production";
const BASE_URL    = IS_SANDBOX
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE       = process.env.MPESA_SHORTCODE;
const PASSKEY         = process.env.MPESA_PASSKEY;
const B2C_SHORTCODE   = process.env.MPESA_B2C_SHORTCODE || SHORTCODE;
const B2C_INITIATOR   = process.env.MPESA_B2C_INITIATOR_NAME;
const B2C_CREDENTIAL  = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
const CALLBACK_BASE   = process.env.MPESA_CALLBACK_BASE_URL;

/* ============================================================
   ACCESS TOKEN — cached, auto-refreshed
============================================================ */
let _token        = null;
let _tokenExpiry  = 0;

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

/** Timestamp: YYYYMMDDHHmmss */
const timestamp = () => {
  const d   = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate()),
    pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds()),
  ].join("");
};

/** STK password = Base64(shortcode + passkey + timestamp) */
const buildStkPassword = (ts) =>
  Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString("base64");

/**
 * Normalize phone to 2547XXXXXXXX.
 * Accepts: 0712345678 / +254712345678 / 712345678
 */
export const normalizePhone = (phone) => {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0"))   return "254" + digits.slice(1);
  if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits;
  return digits;
};

/* ============================================================
   STK PUSH — C2B (parent tops up wallet)
============================================================ */
export const initiateSTKPush = async ({ phone, amount, accountRef, description = "Wallet Top Up" }) => {
  const token = await getAccessToken();
  const ts    = timestamp();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: SHORTCODE,
      Password:          buildStkPassword(ts),
      Timestamp:         ts,
      TransactionType:   "CustomerPayBillOnline",
      Amount:            Math.ceil(amount),
      PartyA:            normalizePhone(phone),
      PartyB:            SHORTCODE,
      PhoneNumber:       normalizePhone(phone),
      CallBackURL:       `${CALLBACK_BASE}/api/mpesa/callback`,
      AccountReference:  accountRef,
      TransactionDesc:   description,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/* ============================================================
   STK STATUS QUERY
============================================================ */
export const querySTKStatus = async (checkoutRequestId) => {
  const token = await getAccessToken();
  const ts    = timestamp();

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
   B2C — Agent withdrawal to M-Pesa
============================================================ */
export const initiateB2C = async ({ phone, amount, remarks = "Agent Withdrawal", occasion = "Withdrawal" }) => {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/b2c/v3/paymentrequest`,
    {
      InitiatorName:      B2C_INITIATOR,
      SecurityCredential: B2C_CREDENTIAL,
      CommandID:          "BusinessPayment",
      Amount:             Math.ceil(amount),
      PartyA:             B2C_SHORTCODE,
      PartyB:             normalizePhone(phone),
      Remarks:            remarks,
      QueueTimeOutURL:    `${CALLBACK_BASE}/api/mpesa/b2c-timeout`,
      ResultURL:          `${CALLBACK_BASE}/api/mpesa/b2c-callback`,
      Occasion:           occasion,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};