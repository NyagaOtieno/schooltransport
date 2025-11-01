import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent({ parentPhone, studentName, eventType, busNumber, session }) {
  const action = eventType === "onBoard" ? "boarded" : "alighted from";
  const message = `${studentName} has ${action} bus ${busNumber} for the ${session} session.`;

  const result = await sendSms(parentPhone, message);

  if (result.success) {
    console.log(`✅ SMS sent to ${parentPhone}: ${message}`);
  } else {
    console.error(`❌ Failed to send SMS to ${parentPhone}:`, result.error);
  }

  return result;
}
