import SibApiV3Sdk from "sib-api-v3-sdk";

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
export async function sendResetOtpEmail(email, otp) {
  await apiInstance.sendTransacEmail({
    sender: {
      name: "TrackMyKid",
      email: "yourgmail@gmail.com", // must be verified in Brevo
    },
    to: [{ email }],
    subject: "Reset Password OTP",
    htmlContent: `
      <p>Your OTP is:</p>
      <h2>${otp}</h2>
      <p>Expires in 5 minutes.</p>
    `,
  });
}
