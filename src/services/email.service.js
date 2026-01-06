import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'mail.trackmykid.co.ke',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 15000,
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
