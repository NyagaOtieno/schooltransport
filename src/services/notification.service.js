// src/services/notification.service.js
import { sendSms } from "../utils/smsGateway.js";

/** Normalize Kenyan phone numbers to +254 format */
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().trim();
  if (p.startsWith("0")) p = p.replace(/^0/, "+254");
  if (p.startsWith("7")) p = `+254${p}`;
  if (!p.startsWith("+254")) p = `+254${p.slice(-9)}`;
  return p;
}

/**
 * ✅ Generic notifier (works for Kid + Asset)
 * mode: "KID" | "ASSET"
 */
export async function notifyRecipient({
  recipientName,
  recipientPhone,
  subjectName,   // child name OR asset name
  eventType,     // CHECKED_IN / CHECKED_OUT (preferred) OR onboard/offboard
  busNumber,
  session,
  mode = "KID",
}) {
  try {
    const phone = normalizePhone(recipientPhone);
    if (!phone || phone.length < 13) return { success: false, error: "Invalid phone number" };

    const normalizedEvent = (eventType || "").toString().toLowerCase();
    const mappedEventType =
      normalizedEvent === "checked_in" || normalizedEvent === "onboard"
        ? "onBoard"
        : normalizedEvent === "checked_out" || normalizedEvent === "offboard"
        ? "offBoard"
        : "onBoard";

    const noun = mode === "ASSET" ? "asset" : "child";
    const action =
      mappedEventType === "onBoard"
        ? (mode === "ASSET" ? "has been DISPATCHED/LOADED onto" : "has BOARDED")
        : (mode === "ASSET" ? "has been DELIVERED/OFFLOADED from" : "has ALIGHTED from");

    const trackLink =
      mode === "ASSET"
        ? (process.env.TRACKMYASSET_LINK || "https://trackmyasset-webapp.vercel.app/")
        : (process.env.TRACKMYKID_LINK || "https://trackmykid-webapp.vercel.app/");

    const message = `Dear ${recipientName}, your ${noun} ${subjectName} ${action} vehicle ${busNumber} for the ${
      session || "N/A"
    } session. Track here: ${trackLink}`;

    const result = await sendSms(phone, message);

    if (!result?.success) return { success: false, error: result?.error || "SMS failed" };

    console.log(`✅ Notification sent to ${phone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ notifyRecipient error:", err);
    return { success: false, error: err.message || err };
  }
}

/** ✅ Backward compatible wrapper: existing Track My Kid code keeps working */
export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType,
  busNumber,
  session,
}) {
  return notifyRecipient({
    recipientName: parentName,
    recipientPhone: parentPhone,
    subjectName: studentName,
    eventType,
    busNumber,
    session,
    mode: "KID",
  });
}

export async function sendOtpSms({ phone, otp, purpose = "password reset" }) {
  try {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 13) return { success: false, error: "Invalid phone number" };

    const message = `Your OTP for ${purpose} is ${otp}. It expires in 10 minutes. Do not share this code.`;
    const result = await sendSms(normalizedPhone, message);
    if (!result?.success) return { success: false, error: result?.error || "OTP SMS failed" };

    console.log(`✅ OTP SMS sent to ${normalizedPhone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ sendOtpSms error:", err);
    return { success: false, error: err.message || err };
  }
}

export async function sendEmergencyAlert({ phone, name = "User", location = "Unknown location" }) {
  try {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 13) return { success: false, error: "Invalid phone number" };

    const message = `🚨 EMERGENCY ALERT 🚨
${name} has triggered a panic alert.
Location: ${location}
Please respond immediately.`;

    const result = await sendSms(normalizedPhone, message);
    if (!result?.success) return { success: false, error: result?.error || "SMS failed" };

    console.log(`🚨 Emergency alert sent to ${normalizedPhone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ sendEmergencyAlert error:", err);
    return { success: false, error: err.message || err };
  }
}
