// src/services/notification.service.js
import { sendSms } from "../utils/smsGateway.js";

/**
 * Send OTP via SMS
 * @param {Object} params
 * @param {string} params.phone - Recipient phone number
 * @param {string} params.userName - Recipient name
 * @param {string} params.otp - 6-digit OTP
 */
export async function sendOtpSms({ phone, userName, otp }) {
  try {
    if (!phone || phone.length < 9) {
      console.error("❌ Invalid phone number for OTP:", phone);
      return { success: false, error: "Invalid phone number" };
    }

    // Normalize phone number
    let normalizedPhone = phone.toString().trim();
    if (normalizedPhone.startsWith("0")) normalizedPhone = normalizedPhone.replace(/^0/, "+254");
    if (normalizedPhone.startsWith("7")) normalizedPhone = `+254${normalizedPhone}`;
    if (!normalizedPhone.startsWith("+254")) normalizedPhone = `+254${normalizedPhone.slice(-9)}`;

    const message = `Dear ${userName || ""}, your OTP for password reset is: ${otp}. It expires in 10 minutes.`;

    console.log("📩 OTP SMS payload:", { to: normalizedPhone, message });

    const result = await sendSms(normalizedPhone, message);

    if (result?.success) {
      console.log(`✅ OTP SMS delivered successfully to ${normalizedPhone}`);
      return { success: true };
    } else {
      console.error("❌ SMS gateway returned error:", result);
      return { success: false, error: "Failed to send OTP SMS" };
    }
  } catch (error) {
    console.error("❌ sendOtpSms() crashed:", error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Existing parent notification
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
    if (!parentPhone || parentPhone.length < 9 || !studentName || !eventType) {
      return { success: false, error: "Missing required fields or invalid phone" };
    }

    let phone = parentPhone.toString().trim();
    if (phone.startsWith("0")) phone = phone.replace(/^0/, "+254");
    if (phone.startsWith("7")) phone = `+254${phone}`;
    if (!phone.startsWith("+254")) phone = `+254${phone.slice(-9)}`;

    const mappedEventType =
      ["checked_in", "onboard"].includes(eventType.toLowerCase())
        ? "onBoard"
        : ["checked_out", "offboard"].includes(eventType.toLowerCase())
        ? "offBoard"
        : "onBoard";

    const action = mappedEventType === "onBoard" ? "has BOARDED" : "has ALIGHTED from";

    const message = `Dear ${parentName}, we wish to notify you that your child ${studentName} ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to track: https://trackmykid-webapp.vercel.app/`;

    const result = await sendSms(phone, message);

    return result?.success ? { success: true } : { success: false, error: "Failed to send SMS" };
  } catch (error) {
    console.error("❌ notifyParent() crashed:", error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Emergency alert (panic)
 */
export async function sendEmergencyAlert({ phoneNumber, panicId, userId }) {
  try {
    if (!phoneNumber || phoneNumber.length < 9) {
      return { success: false, error: "Invalid phone number" };
    }

    let phone = phoneNumber.toString().trim();
    if (phone.startsWith("0")) phone = phone.replace(/^0/, "+254");
    if (phone.startsWith("7")) phone = `+254${phone}`;
    if (!phone.startsWith("+254")) phone = `+254${phone.slice(-9)}`;

    const message = `⚠️ Emergency alert! User ID: ${userId} triggered a panic event (ID: ${panicId}). Check immediately!`;

    const result = await sendSms(phone, message);

    return result?.success ? { success: true } : { success: false, error: "Failed to send SMS" };
  } catch (error) {
    console.error("❌ sendEmergencyAlert() crashed:", error);
    return { success: false, error: error.message || error };
  }
}
