const express = require("express");
const router = express.Router();

const { ocrController } = require("../controllers/ocrController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/ocr", authMiddleware, ocrController);

module.exports = router;