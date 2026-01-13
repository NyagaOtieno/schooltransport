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

/**
 * Notify a parent about a student's bus event
 */
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

/**
 * ✅ Send OTP SMS (FOR AUTH / PASSWORD RESET)
 */
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
