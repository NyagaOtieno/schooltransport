import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType,   // CHECKED_IN / CHECKED_OUT / onboard / offboard
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

    // ---------------- VALIDATION ----------------
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

    // ---------------- EVENT TYPE NORMALIZATION ----------------
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
        : "onBoard"; // DEFAULT = ONBOARD to avoid undefined

    const action =
      mappedEventType === "onBoard"
        ? "has BOARDED"
        : "has ALIGHTED from";

    // ---------------- MESSAGE TEMPLATE ----------------
    const message = `Dear ${parentName}, we wish to notify you that your child ${studentName} ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to track: https://trackmykid-webapp.vercel.app/`;

    console.log("📩 Final SMS payload:", {
      to: phone,
      message,
      mappedEventType,
    });

    // ---------------- SEND SMS ----------------
    let result;
    try {
      result = await sendSms(phone, message);
    } catch (smsErr) {
      console.error("❌ SMS Gateway threw an exception:", smsErr);
      return { success: false, error: smsErr.message || smsErr };
    }

    if (result?.success) {
      console.log(`✅ SMS delivered successfully to ${phone}`);
    } else {
      console.error("❌ SMS gateway returned error:", result);
    }

    return result || { success: false, error: "Unknown SMS gateway response" };
  } catch (error) {
    console.error("❌ notifyParent() crashed:", error);
    return { success: false, error: error.message || error };
  }
}
