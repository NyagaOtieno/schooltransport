import pool from "../config/db.js"; // your PostgreSQL pool
import { sendEmergencyAlert } from "./notification.service.js";

export async function createPanicEvent({
  userId,
  phoneNumber,
  role = "USER",
  ipAddress,
  userAgent
}) {
  // 1️⃣ Save panic event to PostgreSQL
  const query = `
    INSERT INTO panic_events
    (user_id, phone_number, role, ip_address, user_agent, status)
    VALUES ($1, $2, $3, $4, $5, 'PENDING')
    RETURNING id, created_at
  `;

  const values = [
    userId,
    phoneNumber,
    role,
    ipAddress,
    userAgent
  ];

  const { rows } = await pool.query(query, values);
  const panicEvent = rows[0];

  // 2️⃣ Trigger SMS via existing notification.service
  await sendEmergencyAlert({
    phoneNumber,
    panicId: panicEvent.id,
    userId
  });

  return panicEvent;
}
