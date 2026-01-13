// src/services/notification.service.js
import { sendSms } from "../utils/smsGateway.js";

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
    if (!parentPhone || parentPhone.length < 9) {
      return { success: false, error: "Invalid phone number" };
    }

    // Normalize phone number
    let phone = parentPhone.toString().trim();
    if (phone.startsWith("0")) phone = phone.replace(/^0/, "+254");
    if (phone.startsWith("7")) phone = `+254${phone}`;
    if (!phone.startsWith("+254")) phone = `+254${phone.slice(-9)}`;

    const normalizedEvent = eventType.toString().toLowerCase();
    const mappedEventType =
      normalizedEvent === "checked_in" || normalizedEvent === "onboard"
        ? "onBoard"
        : normalizedEvent === "checked_out" || normalizedEvent === "offboard"
        ? "offBoard"
        : "onBoard";

    const action = mappedEventType === "onBoard" ? "has BOARDED" : "has ALIGHTED from";

    const message = `Dear ${parentName}, your child ${studentName} ${action} vehicle ${busNumber} for the ${session || "N/A"} session. Track here: https://trackmykid-webapp.vercel.app/`;

    const result = await sendSms(phone, message);

    if (!result?.success) {
      console.error("❌ SMS failed:", result);
      return { success: false, error: result?.error || "SMS failed" };
    }

    console.log(`✅ SMS sent to ${phone}`);
    return { success: true };
  } catch (err) {
    console.error("❌ notifyParent error:", err);
    return { success: false, error: err.message || err };
  }
}

/**
 * Optional: you can also export other functions from this file
 */
// export async function sendEmergencyAlert(...) { ... }
