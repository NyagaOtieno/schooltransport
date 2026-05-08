// src/utils/smsGateway.js
import axios from "axios";

const MSPACE_URL = "https://api.mspace.co.ke/smsapi/v2/sendtext";
const MSPACE_KEY = process.env.MSPACE_API_KEY;
const MSPACE_USERNAME = process.env.MSPACE_USERNAME;
const MSPACE_SENDER_ID = process.env.MSPACE_SENDER_ID;

export async function sendSms(to, message) {
  try {
    const payload = {
      username: MSPACE_USERNAME,
      senderId: MSPACE_SENDER_ID,
      recipient: to,
      message,
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: MSPACE_KEY,
    };

    const response = await axios.post(MSPACE_URL, payload, { headers });

    console.log("Mspace response:", response.data);

    const messages = response.data?.message || [];
    const failed = messages.filter((m) => String(m.status) !== "111");

    if (failed.length === 0) {
      return { success: true, data: messages };
    } else {
      console.error("Some messages failed:", failed);
      return { success: false, error: failed };
    }
  } catch (error) {
    console.error("Mspace SMS Error:", error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}
