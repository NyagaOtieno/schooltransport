import dotenv from "dotenv";
dotenv.config();

import { sendSms } from "./src/utils/smsGateway.js";

const test = async () => {
  console.log("🚀 Starting SMS test...");

  // Check environment variables
  console.log("🔑 MSPACE_KEY loaded:", Boolean(process.env.MSPACE_API_KEY));
  console.log("👤 MSPACE_USERNAME:", process.env.MSPACE_USERNAME);
  console.log("📨 MSPACE_SENDER_ID:", process.env.MSPACE_SENDER_ID);

  try {
    const result = await sendSms(
      "0722301062",
      "Hello! This is a test SMS from Jendie Auto."
    );

    if (result.success) {
      console.log("✅ SMS sent successfully:", result.data);
    } else {
      console.error("❌ SMS failed:", result.error);
    }
  } catch (err) {
    console.error("💥 Unexpected error:", err.message);
  }
};

// Make sure we actually call the test function
test();
