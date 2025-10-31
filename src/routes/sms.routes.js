import express from "express";
import { sendSms } from "../utils/smsGateway.js";

const router = express.Router();

router.post("/send", async (req, res) => {
  const { phone, message } = req.body;
  const result = await sendSms(phone, message);
  res.json(result);
});

export default router;
