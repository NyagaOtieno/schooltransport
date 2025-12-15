const express = require("express");
const router = express.Router();

const panicController = require("../controllers/paniccontroller");
const jwtAuth = require("../middleware/jwt"); // matches your utils/jwt.js

router.post(
  "/panic",
  jwtAuth,
  panicController.triggerPanic
);

module.exports = router;
