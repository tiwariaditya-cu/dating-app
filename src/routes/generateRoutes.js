const express = require("express");
const router = express.Router();

const { generateReplies } = require("../controllers/generateController");
const authMiddleware = require("../middleware/authMiddleware");

// POST /api/generate
router.post("/generate", authMiddleware, generateReplies);

module.exports = router;