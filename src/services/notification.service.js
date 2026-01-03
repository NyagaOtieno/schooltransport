// src/services/notification.service.js
import { sendSms } from "../utils/smsGateway.js";

/**
 * Existing notifyParent function
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
    console.log("🔔 notifyParent() called with:", {
      parentName,
      parentPhone,
      studentName,
      eventType,
      busNumber,
      session,
    });

    if (!parentPhone || parentPhone.length < 9) {
      console.error("❌ Invalid parentPhone:", parentPhone);
      return { success: false, error: "Invalid phone number" };
    }
    if (!studentName || !eventType) {
      console.error("❌ Missing studentName or eventType");
      return { success: false, error: "Missing event fields" };
    }

    // Normalize & sanitize phone number
    let phone = parentPhone.toString().trim();
    if (phone.startsWith("0")) phone = phone.replace(/^0/, "+254");
    if (phone.startsWith("7")) phone = `+254${phone}`;
    if (!phone.startsWith("+254")) phone = `+254${phone.slice(-9)}`;

    const normalizedEvent = eventType.toString().toLowerCase();
    let mappedEventType =
      normalizedEvent === "checked_in"
        ? "onBoard"
        : normalizedEvent === "checked_out"
        ? "offBoard"
        : normalizedEvent === "onboard"
        ? "onBoard"
        : normalizedEvent === "offboard"
        ? "offBoard"
        : "onBoard";

    const action =
      mappedEventType === "onBoard" ? "has BOARDED" : "has ALIGHTED from";

    const message = `Dear ${parentName}, we wish to notify you that your child ${studentName} ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to track: https://trackmykid-webapp.vercel.app/`;

    console.log("📩 Final SMS payload:", { to: phone, message, mappedEventType });

    let result;
    try {
      result = await sendSms(phone, message);
    } catch (smsErr) {
      console.error("❌ SMS Gateway threw an exception:", smsErr);
      return { success: false, error: smsErr.message || smsErr };
    }

    if (result?.success) console.log(`✅ SMS delivered successfully to ${phone}`);
    else console.error("❌ SMS gateway returned error:", result);

    return result || { success: false, error: "Unknown SMS gateway response" };
  } catch (error) {
    console.error("❌ notifyParent() crashed:", error);
    return { success: false, error: error.message || error };
  }
}

/**
 * New function: sendEmergencyAlert for panic events
 */
export async function sendEmergencyAlert({ phoneNumber, panicId, userId }) {
  try {
    if (!phoneNumber || phoneNumber.length < 9) {
      console.error("❌ Invalid phoneNumber for panic:", phoneNumber);
      return { success: false, error: "Invalid phone number" };
    }

    // Normalize phone number
    let phone = phoneNumber.toString().trim();
    if (phone.startsWith("0")) phone = phone.replace(/^0/, "+254");
    if (phone.startsWith("7")) phone = `+254${phone}`;
    if (!phone.startsWith("+254")) phone = `+254${phone.slice(-9)}`;

    const message = `⚠️ Emergency alert! User ID: ${userId} triggered a panic event (ID: ${panicId}). Check immediately!`;

    console.log("📩 Panic SMS payload:", { to: phone, message });

    const result = await sendSms(phone, message);

    if (result?.success) console.log(`✅ Panic SMS delivered successfully to ${phone}`);
    else console.error("❌ Panic SMS failed:", result);

    return result || { success: false, error: "Unknown SMS gateway response" };
  } catch (error) {
    console.error("❌ sendEmergencyAlert() crashed:", error);
    return { success: false, error: error.message || error };
  }
}
