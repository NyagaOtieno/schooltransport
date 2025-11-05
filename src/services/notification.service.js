import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType, // expects CHECKED_IN / CHECKED_OUT (from manifest route)
  busNumber,
  session,
}) {
  try {
    console.log("🔔 notifyParent received:", {
      parentName,
      parentPhone,
      studentName,
      eventType,
      busNumber,
      session,
    });

    // Map manifest API statuses to friendly event types
    const mappedEventType =
      eventType === "CHECKED_IN"
        ? "onBoard"
        : eventType === "CHECKED_OUT"
        ? "offBoard"
        : eventType === "onBoard" || eventType === "onboard"
        ? "onBoard"
        : eventType === "offBoard" || eventType === "offboard"
        ? "offBoard"
        : "onBoard"; // default now to onBoard

    const action =
      mappedEventType === "onBoard"
        ? "has boarded"
        : "has alighted from"; // Removed "updated status" case

    const message = `Dear ${parentName}, we wish to notify you that your child ${studentName} ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to track: https://trackmykid-webapp.vercel.app/`;

    console.log("📩 Composed SMS:", { to: parentPhone, message });

    const result = await sendSms(parentPhone, message);

    if (result.success) {
      console.log(`✅ SMS sent to ${parentPhone}: ${message}`);
    } else {
      console.error(`❌ Failed to send SMS to ${parentPhone}:`, result.error);
    }

    return result;
  } catch (error) {
    console.error(`❌ Error in notifyParent:`, error);
    return { success: false, error: error?.message || error };
  }
}
