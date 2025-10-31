import axios from "axios";

const MSPACE_URL = "https://api.mspace.co.ke/smsapi/v2/sendtext";
const MSPACE_KEY = process.env.MSPACE_API_KEY; // store securely in .env

export async function sendSms(to, message) {
  try {
    const payload = {
      to,
      message,
      senderid: "SchoolTrack", // your sender name (must be approved by Mspace)
    };

    const headers = {
      "Content-Type": "application/json",
      apikey: MSPACE_KEY,
    };

    const response = await axios.post(MSPACE_URL, payload, { headers });

    return { success: true, data: response.data };
  } catch (error) {
    console.error("Mspace SMS Error:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}
