
import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER, // usually your email
    pass: process.env.BREVO_API_KEY,
  },
});


export async function sendResetOtpEmail(email, otp) {
  await transporter.sendMail({
    from: `"TrackMyKid" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Reset Your Password",
    html: `
      <h3>Password Reset</h3>
      <p>Your OTP is:</p>
      <h2>${otp}</h2>
      <p>This OTP expires in 10 minutes.</p>
    `,
  });
}
