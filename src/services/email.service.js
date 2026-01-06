import nodemailer from "nodemailer";

// Create a reusable transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // SSL required for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

// ✅ Verify SMTP on startup
transporter.verify((err) => {
  if (err) {
    console.error("❌ SMTP connection failed:", err.message);
  } else {
    console.log("✅ Gmail SMTP ready to send emails");
  }
});

/**
 * Send a password reset OTP email
 * Retries once after 5 seconds if failed
 */
export async function sendResetOtpEmail(email, otp, retry = true) {
  try {
    const info = await transporter.sendMail({
      from: `"TrackMyKid" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password",
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h3>Password Reset</h3>
          <p>Your OTP is:</p>
          <h2 style="letter-spacing: 2px;">${otp}</h2>
          <p>This OTP expires in <strong>10 minutes</strong>.</p>
          <p>If you did not request this, ignore this email.</p>
        </div>
      `,
    });

    console.log(`✅ OTP sent to ${email}, messageId: ${info.messageId}`);
    return true;

  } catch (error) {
    console.error(`❌ Email send failed for ${email}:`, error.message);

    // 🔁 Retry ONCE after 5 seconds
    if (retry) {
      console.log("🔁 Retrying in 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return sendResetOtpEmail(email, otp, false);
    }

    return false;
  }
}
