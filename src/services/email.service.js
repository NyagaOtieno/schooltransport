import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'mail.trackmykid.co.ke',
  port: 587,
  secure: false, // use STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

export async function sendResetOtpEmail(email, otp, retry = true) {
  try {
    const info = await transporter.sendMail({
      from: `"TrackMyKid" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h3>Password Reset</h3>
          <p>Your OTP is:</p>
          <h2 style="letter-spacing: 2px;">${otp}</h2>
          <p>This OTP expires in <strong>10 minutes</strong>.</p>
          <p>If you did not request this, please ignore this email.</p>
        </div>
      `,
    });

    console.log(`✅ OTP email sent to ${email}`, info.messageId);
    return true;

  } catch (error) {
    console.error(`❌ Email send failed for ${email}:`, error.message);

    // 🔁 Retry ONCE after 5 seconds
    if (retry) {
      console.log('🔁 Retrying OTP email in 5 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return sendResetOtpEmail(email, otp, false);
    }

    return false;
  }
}
