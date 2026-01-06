import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'mail.trackmykid.co.ke',
  port: 465,
  secure: true, // correct for 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

// Optional: verify SMTP on startup (VERY useful)
transporter.verify((error, success) => {
  if (error) {
    console.error('SMTP connection failed:', error);
  } else {
    console.log('SMTP server is ready to send emails');
  }
});

export async function sendResetOtpEmail(email, otp, retry = true) {
  try {
    const info = await transporter.sendMail({
      from: `"TrackMyKid" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password',
      html: `
        <h3>Password Reset</h3>
        <p>Your OTP is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
      `,
    });

    console.log(`OTP email sent to ${email}`, info.messageId);
    return true;
  } catch (error) {
    console.error(`Email send failed for ${email}:`, error.message);

    // 🔁 Retry ONCE after 5 seconds
    if (retry) {
      console.log('Retrying OTP email in 5 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return sendResetOtpEmail(email, otp, false);
    }

    return false;
  }
}

