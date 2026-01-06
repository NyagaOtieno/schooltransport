const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,       // e.g., smtp.gmail.com
  port: 587,                          // Use 587 for TLS
  secure: false,                       // Must be false for 587
  auth: {
    user: process.env.EMAIL_USER,     // Your email
    pass: process.env.EMAIL_PASS,     // Your password or App Password for Gmail
  },
  tls: {
    ciphers: 'TLSv1.2',               // Optional: enforce TLS version
  },
  connectionTimeout: 30000,            // Optional: 10s timeout
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
