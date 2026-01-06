import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // your app password
  },
  tls: { rejectUnauthorized: false },
});

transporter.verify((err) => {
  if (err) console.error('SMTP failed:', err.message);
  else console.log('SMTP ready to send emails');
});

export async function sendResetOtpEmail(email, otp) {
  try {
    const info = await transporter.sendMail({
      from: `"TrackMyKid" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password',
      html: `<h3>Password Reset</h3><p>Your OTP: <strong>${otp}</strong></p>`,
    });
    console.log('OTP sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Email send failed:', error.message);
    return false;
  }
}
