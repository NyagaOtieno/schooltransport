import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// verify on startup
transporter.verify((err) => {
  if (err) console.error('❌ SMTP connection failed:', err.message);
  else console.log('✅ SMTP server is ready to send emails');
});

export async function sendResetOtpEmail(email, otp, retry = true) {
  try {
    const info = await transporter.sendMail({
      from: `"TrackMyKid" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password',
      html: `<h3>OTP: ${otp}</h3>`,
    });
    console.log(`✅ OTP email sent to ${email}`, info.messageId);
    return true;
  } catch (err) {
    console.error(`❌ Email send failed for ${email}:`, err.message);
    if (retry) {
      console.log('🔁 Retrying in 5 seconds...');
      await new Promise(r => setTimeout(r, 5000));
      return sendResetOtpEmail(email, otp, false);
    }
    return false;
  }
}
