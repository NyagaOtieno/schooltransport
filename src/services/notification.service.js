// src/services/notification.service.js
import { sendSms } from "../utils/smsGateway.js";

/**
 * Normalize Kenyan phone numbers to +254 format
 */
function normalizePhone(phone) {
  if (!phone) return null;

  let p = phone.toString().trim();

  if (p.startsWith("0")) p = p.replace(/^0/, "+254");
  if (p.startsWith("7")) p = `+254${p}`;
  if (!p.startsWith("+254")) p = `+254${p.slice(-9)}`;

  return p;
}

export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType,
  busNumber,
  session,
}) {
  try {
    const phone = normalizePhone(parentPhone);
    if (!phone || phone.length < 13) {
      return { success: false, error: "Invalid phone number" };
    }

    const normalizedEvent = eventType.toString().toLowerCase();
    const mappedEventType =
      normalizedEvent === "checked_in" || normalizedEvent === "onboard"
        ? "onBoard"
        : normalizedEvent === "checked_out" || normalizedEvent === "offboard"
        ? "offBoard"
        : "onBoard";

    const action =
      mappedEventType === "onBoard"
        ? "has BOARDED"
        : "has ALIGHTED from";

    const message = `Dear ${parentName}, your child ${studentName} ${action} vehicle ${busNumber} for the ${
      session || "N/A"
    } session. Track here: https://trackmykid-webapp.vercel.app/`;

    const result = await sendSms(phone, message);

    if (!result?.success) {
      console.error("❌ SMS failed:", result);
      return { success: false, error: result?.error || "SMS failed" };
    }

    console.log(`✅ Parent SMS sent to ${phone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ notifyParent error:", err);
    return { success: false, error: err.message || err };
  }
}

export async function sendOtpSms({ phone, otp, purpose = "password reset" }) {
  try {
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || normalizedPhone.length < 13) {
      return { success: false, error: "Invalid phone number" };
    }

    const message = `Your OTP for ${purpose} is ${otp}. It expires in 10 minutes. Do not share this code.`;

    const result = await sendSms(normalizedPhone, message);

    if (!result?.success) {
      console.error("❌ OTP SMS failed:", result);
      return { success: false, error: result?.error || "OTP SMS failed" };
    }

    console.log(`✅ OTP SMS sent to ${normalizedPhone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ sendOtpSms error:", err);
    return { success: false, error: err.message || err };
  }
}

export async function sendEmergencyAlert({
  phone,
  name = "User",
  location = "Unknown location",
}) {
  try {
    if (!phone) {
      return { success: false, error: "Phone number is required" };
    }

    let normalizedPhone = phone.toString().trim();
    if (normalizedPhone.startsWith("0"))
      normalizedPhone = normalizedPhone.replace(/^0/, "+254");
    if (normalizedPhone.startsWith("7"))
      normalizedPhone = `+254${normalizedPhone}`;
    if (!normalizedPhone.startsWith("+254"))
      normalizedPhone = `+254${normalizedPhone.slice(-9)}`;

    const message = `🚨 EMERGENCY ALERT 🚨
${name} has triggered a panic alert.
Location: ${location}
Please respond immediately.`;

    const result = await sendSms(normalizedPhone, message);

    if (!result?.success) {
      console.error("❌ Emergency SMS failed:", result);
      return { success: false, error: result?.error || "SMS failed" };
    }

    console.log(`🚨 Emergency alert sent to ${normalizedPhone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ sendEmergencyAlert error:", err);
    return { success: false, error: err.message || err };
  }
}
