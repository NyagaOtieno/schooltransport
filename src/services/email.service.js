// src/services/email.service.js
import SibApiV3Sdk from "sib-api-v3-sdk";

// Initialize Brevo (formerly Sendinblue) client
const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Send OTP email for password reset
 * @param {string} email - Recipient email
 * @param {string} otp - One-time password
 */
export async function sendResetOtpEmail(email, otp) {
  try {
    await apiInstance.sendTransacEmail({
      sender: {
        name: "TrackMyKid",
        email: "yourgmail@gmail.com", // Must be verified in Brevo
      },
      to: [{ email }],
      subject: "Reset Password OTP",
      htmlContent: `
        <p>Your OTP is:</p>
        <h2>${otp}</h2>
        <p>Expires in 5 minutes.</p>
      `,
    });
    console.log(`OTP sent successfully to ${email}`);
  } catch (error) {
    console.error("Failed to send OTP email:", error);
  }
}
