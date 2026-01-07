// test-email.js
import 'dotenv/config';
import { sendResetOtpEmail } from './src/services/email.service.js';

async function test() {
  const result = await sendResetOtpEmail("nyagaotieno@gmail.com", "123456");
  console.log("Email send result:", result);
}

test();
