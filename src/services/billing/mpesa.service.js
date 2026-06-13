// src/services/billing/mpesa.service.js
// Safaricom Daraja API — Complete Production Implementation
//
// Covered APIs:
//   1.  OAuth Token
//   2.  M-Pesa Express STK Push  (C2B Express / Lipa na M-Pesa)
//   3.  STK Push Query
//   4.  C2B Register URLs        (v1 + v2)
//   5.  C2B Simulate             (sandbox only)
//   6.  B2C Payment              (agent M-Pesa withdrawal)
//   7.  B2B Payment              (BusinessPayBill / BusinessBuyGoods / B2CAccountTopUp)
//   8.  Reversal
//   9.  Transaction Status Query
//   10. Account Balance Query
//   11. Dynamic QR Code
//   12. Bill Manager             (opt-in, invoicing, reconciliation, cancel, update)

import axios from "axios";

/* ============================================================
   ENVIRONMENT CONFIG
============================================================ */
export const IS_SANDBOX = process.env.MPESA_ENV !== "production";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PROD_BASE    = "https://api.safaricom.co.ke";
const BASE_URL     = IS_SANDBOX ? SANDBOX_BASE : PROD_BASE;

// Credentials
const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;

// STK Push / M-Pesa Express
const STK_SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY       = process.env.MPESA_PASSKEY;

// C2B Paybill
const C2B_SHORTCODE = process.env.MPESA_C2B_SHORTCODE || process.env.MPESA_SHORTCODE;

// B2C
const B2C_SHORTCODE  = process.env.MPESA_B2C_SHORTCODE  || process.env.MPESA_SHORTCODE;
const B2C_INITIATOR  = process.env.MPESA_B2C_INITIATOR_NAME;
const B2C_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL;

// B2B
const B2B_SHORTCODE  = process.env.MPESA_B2B_SHORTCODE  || process.env.MPESA_SHORTCODE;
const B2B_INITIATOR  = process.env.MPESA_B2B_INITIATOR_NAME  || B2C_INITIATOR;
const B2B_CREDENTIAL = process.env.MPESA_B2B_SECURITY_CREDENTIAL || B2C_CREDENTIAL;

// Callbacks
const CALLBACK_BASE = process.env.MPESA_CALLBACK_BASE_URL;

/* ============================================================
   1. OAUTH TOKEN — cached, auto-refreshed 30s before expiry
============================================================ */
let _token       = null;
let _tokenExpiry = 0;

export const getAccessToken = async () => {
  if (_token && Date.now() < _tokenExpiry) return _token;

  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET must be set.");
  }

  const creds    = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` } }
  );

  _token       = data.access_token;
  _tokenExpiry = Date.now() + (Number(data.expires_in) - 30) * 1000;
  return _token;
};

/* ============================================================
   SHARED HELPERS
============================================================ */

/** Daraja timestamp: YYYYMMDDHHmmss */
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
 * Normalize Kenyan phone to 254XXXXXXXXX.
 * Accepts: 0712345678 | +254712345678 | 712345678 | 254712345678
 */
export const normalizePhone = (phone) => {
  const d = String(phone).replace(/\D/g, "");
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0")   && d.length === 10) return "254" + d.slice(1);
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) return "254" + d;
  return d;
};

/** Authenticated POST helper */
const post = async (path, body) => {
  const token    = await getAccessToken();
  const { data } = await axios.post(`${BASE_URL}${path}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

/* ============================================================
   2. M-PESA EXPRESS — STK PUSH  (Lipa na M-Pesa Online)
   Parent tops up wallet — sends PIN prompt to their phone.
   Production URL: /mpesa/stkpush/v1/processrequest
   Callback: POST /api/mpesa/stk-callback
============================================================ */
export const initiateSTKPush = async ({
  phone,
  amount,
  accountRef,
  description = "Wallet Top Up",
}) => {
  const ts = mpesaTimestamp();
  return post("/mpesa/stkpush/v1/processrequest", {
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
    TransactionDesc:   String(description).slice(0, 13),
  });
  // { ResponseCode, ResponseDescription, MerchantRequestID,
  //   CheckoutRequestID, CustomerMessage }
};

/* ============================================================
   3. STK PUSH QUERY
   Production URL: /mpesa/stkpushquery/v1/query
   Poll payment status after STK push sent.
============================================================ */
export const querySTKStatus = async (checkoutRequestId) => {
  const ts = mpesaTimestamp();
  return post("/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: STK_SHORTCODE,
    Password:          buildStkPassword(ts),
    Timestamp:         ts,
    CheckoutRequestID: checkoutRequestId,
  });
  // { ResponseCode, ResultCode, ResultDesc }
};

/* ============================================================
   4a. C2B REGISTER URLs — v1 (C2B PayBill)
   Production URL: /mpesa/c2b/v1/registerurl
   Register validation + confirmation callback URLs.
============================================================ */
export const registerC2BUrlsV1 = async (responseType = "Completed") =>
  post("/mpesa/c2b/v1/registerurl", {
    ShortCode:       C2B_SHORTCODE,
    ResponseType:    responseType,
    ConfirmationURL: `${CALLBACK_BASE}/api/mpesa/c2b/confirm`,
    ValidationURL:   `${CALLBACK_BASE}/api/mpesa/c2b/validate`,
  });

/* ============================================================
   4b. C2B REGISTER URLs — v2
   Production URL: /mpesa/c2b/v2/registerurl
   Enhanced version with additional options.
============================================================ */
export const registerC2BUrls = async (responseType = "Completed") =>
  post("/mpesa/c2b/v2/registerurl", {
    ShortCode:       C2B_SHORTCODE,
    ResponseType:    responseType,
    ConfirmationURL: `${CALLBACK_BASE}/api/mpesa/c2b/confirm`,
    ValidationURL:   `${CALLBACK_BASE}/api/mpesa/c2b/validate`,
  });

/* ============================================================
   5. C2B SIMULATE (sandbox only)
   Simulates a parent paying via M-Pesa menu to paybill.
   BillRefNumber = "TRK{userId}" (e.g. "TRK42")
============================================================ */
export const simulateC2B = async ({ phone, amount, billRef = "TEST" }) => {
  if (!IS_SANDBOX) throw new Error("C2B simulation is only available in sandbox.");
  return post("/mpesa/c2b/v1/simulate", {
    ShortCode:     C2B_SHORTCODE,
    CommandID:     "CustomerPayBillOnline",
    Amount:        Math.ceil(amount),
    Msisdn:        normalizePhone(phone),
    BillRefNumber: String(billRef).slice(0, 20),
  });
};

/* ============================================================
   6. B2C PAYMENT — Business to Customer
   Agent M-Pesa withdrawal — money sent directly, no PIN needed.
   Production URL: /mpesa/b2c/v1/paymentrequest
   Callback: POST /api/mpesa/b2c/callback
   Timeout:  POST /api/mpesa/b2c/timeout
   CommandID: "BusinessPayment" | "SalaryPayment" | "PromotionPayment"
============================================================ */
export const initiateB2C = async ({
  phone,
  amount,
  remarks  = "Agent Withdrawal",
  occasion = "Withdrawal",
  commandId = "BusinessPayment",
}) =>
  post("/mpesa/b2c/v1/paymentrequest", {
    InitiatorName:      B2C_INITIATOR,
    SecurityCredential: B2C_CREDENTIAL,
    CommandID:          commandId,
    Amount:             Math.ceil(amount),
    PartyA:             B2C_SHORTCODE,
    PartyB:             normalizePhone(phone),
    Remarks:            remarks,
    QueueTimeOutURL:    `${CALLBACK_BASE}/api/mpesa/b2c/timeout`,
    ResultURL:          `${CALLBACK_BASE}/api/mpesa/b2c/callback`,
    Occasion:           occasion,
  });
  // { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }

/* ============================================================
   7. B2B PAYMENT — Business to Business
   Agent bank / paybill / till transfer.
   Production URL: /mpesa/b2b/v1/paymentrequest
   Callback: POST /api/mpesa/b2b/callback
   Timeout:  POST /api/mpesa/b2b/timeout

   CommandID:
     "BusinessPayBill"    → to another paybill (use SenderIdentifierType=4, ReceiverIdentifierType=4)
     "BusinessBuyGoods"   → to till number    (use SenderIdentifierType=4, ReceiverIdentifierType=2)
     "B2CAccountTopUp"    → top up B2C utility (use SenderIdentifierType=4, ReceiverIdentifierType=4)

   IdentifierType:
     1 = MSISDN  |  2 = Till Number  |  4 = Shortcode / Paybill
============================================================ */
export const initiateB2B = async ({
  receiverShortcode,
  amount,
  commandId          = "BusinessPayBill",
  senderIdentifier   = "4",
  receiverIdentifier = "4",
  remarks            = "Agent Bank Transfer",
  occasion           = "BankTransfer",
  accountRef         = "",
}) =>
  post("/mpesa/b2b/v1/paymentrequest", {
    Initiator:              B2B_INITIATOR,
    SecurityCredential:     B2B_CREDENTIAL,
    CommandID:              commandId,
    SenderIdentifierType:   senderIdentifier,
    ReceiverIdentifierType: receiverIdentifier,
    Amount:                 Math.ceil(amount),
    PartyA:                 B2B_SHORTCODE,
    PartyB:                 String(receiverShortcode),
    AccountReference:       accountRef,
    Remarks:                remarks,
    QueueTimeOutURL:        `${CALLBACK_BASE}/api/mpesa/b2b/timeout`,
    ResultURL:              `${CALLBACK_BASE}/api/mpesa/b2b/callback`,
  });

/** Convenience: BusinessBuyGoods (till number) */
export const initiateB2BGoodsPayment = ({ tillNumber, amount, remarks, accountRef }) =>
  initiateB2B({
    receiverShortcode:  tillNumber,
    amount,
    commandId:          "BusinessBuyGoods",
    receiverIdentifier: "2",
    remarks:            remarks || "Goods Payment",
    accountRef:         accountRef || "",
  });

/** Convenience: B2C Account TopUp */
export const initiateB2BAccountTopUp = ({ receiverShortcode, amount, accountRef }) =>
  initiateB2B({
    receiverShortcode,
    amount,
    commandId:  "B2CAccountTopUp",
    accountRef: accountRef || "",
  });

/* ============================================================
   8. REVERSAL
   Reverse a completed M-Pesa transaction.
   Production URL: /mpesa/reversal/v1/request
   Callback: POST /api/mpesa/reversal/callback
   Timeout:  POST /api/mpesa/reversal/timeout
   IdentifierType: 11 = Organisation ShortCode
============================================================ */
export const initiateReversal = async ({
  transactionId,
  amount,
  receiverParty,
  remarks          = "Reversal",
  occasion         = "",
  receiverIdentifier = "11",
}) =>
  post("/mpesa/reversal/v1/request", {
    Initiator:              B2C_INITIATOR,
    SecurityCredential:     B2C_CREDENTIAL,
    CommandID:              "TransactionReversal",
    TransactionID:          transactionId,
    Amount:                 Math.ceil(amount),
    ReceiverParty:          receiverParty,
    RecieverIdentifierType: receiverIdentifier,
    Remarks:                remarks,
    Occasion:               occasion,
    QueueTimeOutURL:        `${CALLBACK_BASE}/api/mpesa/reversal/timeout`,
    ResultURL:              `${CALLBACK_BASE}/api/mpesa/reversal/callback`,
  });

/* ============================================================
   9. TRANSACTION STATUS QUERY
   Check the status of any M-Pesa transaction by TransactionID.
   Production URL: /mpesa/transactionstatus/v1/query
   IdentifierType: 1=MSISDN | 2=Till | 4=Shortcode
============================================================ */
export const queryTransactionStatus = async ({
  transactionId,
  partyA          = B2C_SHORTCODE,
  identifierType  = "4",
  remarks         = "Status Query",
  occasion        = "",
}) =>
  post("/mpesa/transactionstatus/v1/query", {
    Initiator:          B2C_INITIATOR,
    SecurityCredential: B2C_CREDENTIAL,
    CommandID:          "TransactionStatusQuery",
    TransactionID:      transactionId,
    PartyA:             partyA,
    IdentifierType:     identifierType,
    Remarks:            remarks,
    Occasion:           occasion,
    ResultURL:          `${CALLBACK_BASE}/api/mpesa/status/callback`,
    QueueTimeOutURL:    `${CALLBACK_BASE}/api/mpesa/status/timeout`,
  });

/* ============================================================
   10. ACCOUNT BALANCE QUERY
   Check M-Pesa account balance.
   Production URL: /mpesa/accountbalance/v1/query
   IdentifierType: 4 = Organisation ShortCode
============================================================ */
export const queryAccountBalance = async ({
  partyA         = B2C_SHORTCODE,
  identifierType = "4",
  remarks        = "Balance Query",
}) =>
  post("/mpesa/accountbalance/v1/query", {
    Initiator:          B2C_INITIATOR,
    SecurityCredential: B2C_CREDENTIAL,
    CommandID:          "AccountBalance",
    PartyA:             partyA,
    IdentifierType:     identifierType,
    Remarks:            remarks,
    QueueTimeOutURL:    `${CALLBACK_BASE}/api/mpesa/balance/timeout`,
    ResultURL:          `${CALLBACK_BASE}/api/mpesa/balance/callback`,
  });

/* ============================================================
   11. DYNAMIC QR CODE
   Generate a QR code for M-Pesa payments.
   Production URL: /mpesa/qrcode/v1/generate
   TrxCodeType:
     BG = Buy Goods   PB = Pay Bill   SM = Send Money
     SB = Send to Business   WA = Withdraw Cash at Agent
============================================================ */
export const generateQRCode = async ({
  merchantName,
  refNo,
  amount,
  trxCodeType = "PB",   // Pay Bill
  cpi,                  // Credit Party Identifier (shortcode or phone)
  size        = "400",
}) =>
  post("/mpesa/qrcode/v1/generate", {
    MerchantName: merchantName,
    RefNo:        refNo,
    Amount:       Math.ceil(amount),
    TrxCodeType:  trxCodeType,
    CPI:          cpi || C2B_SHORTCODE,
    Size:         String(size),
  });

/* ============================================================
   12. BILL MANAGER
   Manage business invoices on M-Pesa.
   Base: /v1/billmanager-invoice/v1/billmanager-invoice/

   12a. Opt-In / Onboarding (one-time setup)
   12b. Single Invoice
   12c. Bulk Invoices
   12d. Reconciliation
   12e. Cancel Single Invoice
   12f. Cancel Bulk Invoices
   12g. Update Onboarding Details
   12h. Update Single Invoice
   12i. Update Bulk Invoices
============================================================ */
const BILL_BASE = "/v1/billmanager-invoice/v1/billmanager-invoice";

/** 12a. Opt-In — register your business for Bill Manager */
export const billManagerOptIn = async ({
  shortcode        = C2B_SHORTCODE,
  email,
  officialContact,
  sendReminders    = "1",
  logo             = "",
  callbackUrl      = `${CALLBACK_BASE}/api/mpesa/billmanager/callback`,
}) =>
  post(`${BILL_BASE}/optin`, {
    shortcode,
    email,
    officialContact,
    sendReminders,
    logo,
    callbackUrl,
  });

/** 12b. Send a single invoice */
export const billManagerSingleInvoice = async ({
  externalReference,
  billedTo,
  billedFullName,
  billedPeriod,
  invoiceName,
  dueDate,
  accountReference,
  amount,
  invoiceItems = [],
}) =>
  post(`${BILL_BASE}/single-invoicing`, {
    externalReference,
    billedTo,
    billedFullName,
    billedPeriod,
    invoiceName,
    dueDate,
    accountReference,
    amount: String(amount),
    invoiceItems,
  });

/** 12c. Send bulk invoices */
export const billManagerBulkInvoices = async (invoices) =>
  post(`${BILL_BASE}/bulk-invoicing`, invoices);

/** 12d. Reconciliation — mark invoices as paid */
export const billManagerReconciliation = async ({
  paymentDate,
  paidAmount,
  externalReference,
  accountReference,
  transactionId,
  phoneNumber,
  fullName,
}) =>
  post(`${BILL_BASE}/reconciliation`, {
    paymentDate,
    paidAmount:        String(paidAmount),
    externalReference,
    accountReference,
    transactionId,
    phoneNumber:       normalizePhone(phoneNumber),
    fullName,
  });

/** 12e. Cancel a single invoice */
export const billManagerCancelSingleInvoice = async (externalReference) =>
  post(`${BILL_BASE}/cancel-single-invoice`, { externalReference });

/** 12f. Cancel bulk invoices */
export const billManagerCancelBulkInvoices = async (externalReferences) =>
  post(`${BILL_BASE}/cancel-bulk-invoice`, { externalReferences });

/** 12g. Update onboarding details */
export const billManagerUpdateOnboarding = async (updates) =>
  post(`${BILL_BASE}/change-optin-details`, updates);

/** 12h. Update a single invoice */
export const billManagerUpdateSingleInvoice = async (updates) =>
  post(`${BILL_BASE}/change-invoice`, updates);

/** 12i. Update bulk invoices */
export const billManagerUpdateBulkInvoices = async (updates) =>
  post(`${BILL_BASE}/change-invoices`, updates);