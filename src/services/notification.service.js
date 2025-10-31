import { sendSms } from "../utils/smsGateway.js";

export async function notifyParent(eventType, student, busNumber) {
  if (!student?.parentPhone) {
    console.warn("⚠️ Missing parent phone number for student:", student?.name);
    return;
  }

  const message =
    eventType === "onBoard"
      ? `${student.name} has boarded bus ${busNumber}.`
      : `${student.name} has alighted from bus ${busNumber}.`;

  const result = await sendSms(student.parentPhone, message);

  if (result.success) {
    console.log(`✅ SMS sent to ${student.parentPhone}: ${message}`);
  } else {
    console.error(`❌ Failed to send SMS:`, result.error);
  }

  return result;
}
