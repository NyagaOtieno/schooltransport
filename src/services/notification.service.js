import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent({
  parentName,
  parentPhone,
  studentName,
  eventType,
  busNumber,
  session,
}) {
  try {
    const action = eventType === "onBoard" ? "boarded" : "alighted from";
    const message = `Dear ${parentName}, we wish to notify you that your Child ${studentName} has safely ${action} vehicle registration ${busNumber} for the ${session} session. Follow this link to fuata the steps https://trackmykid.vercel.app/.`;

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
