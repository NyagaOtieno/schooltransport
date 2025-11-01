import axios from "axios";

const MSPACE_URL = "https://api.mspace.co.ke/smsapi/v2/sendtext";
const MSPACE_KEY = process.env.MSPACE_API_KEY; // Store this securely in .env
const MSPACE_USERNAME = process.env.MSPACE_USERNAME; // Add this to .env
const MSPACE_SENDER_ID = process.env.MSPACE_SENDER_ID; // Add this to .env and ensure it’s approved in Mspace

export async function sendSms(to, message) {
  try {
    const payload = {
      username: MSPACE_USERNAME, // Mspace Dashboard username
      senderId: MSPACE_SENDER_ID, // Must be approved by Mspace
      recipient: to, // Phone number(s), comma-separated if multiple
      message, // SMS text content
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: MSPACE_KEY, // ✅ Correct header key from Mspace docs
    };

    const response = await axios.post(MSPACE_URL, payload, { headers });

    if (response.data?.status === 1) {
      return { success: true, data: response.data };
    } else {
      console.error("Mspace SMS failed:", response.data);
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.error("Mspace SMS Error:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}
