import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType, // expects CHECK_IN or CHECKED_OUT
  busNumber,
  session,
}) {
  try {
    // Map API statuses to SMS-friendly event types
    const mappedEventType =
      eventType === "CHECK_IN"
        ? "onBoard"
        : eventType === "CHECKED_OUT"
        ? "offBoard"
        : "update";

    const action =
      mappedEventType === "onBoard"
        ? "has boarded"
        : mappedEventType === "offBoard"
        ? "has alighted from"
        : "has Onboarded";

    const message = `Dear ${parentName}, we wish to notify you that your child ${studentName} has safely ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to track: https://trackmykid.vercel.app/.`;

    const result = await sendSms(parentPhone, message);

    if (result.success) {
      console.log(`✅ SMS sent to ${parentPhone}: ${message}`);
    } else {
      console.error(`❌ Failed to send SMS to ${parentPhone}:`, result.error);
    }

    return result;
  } catch (error) {
    console.error(`❌ Error in notifyParent:`, error.message);
    return { success: false, error: error.message };
  }
}
