const express = require("express");
const router = express.Router();

const { saveChosenReply } = require("../controllers/messageController");
const authMiddleware = require("../middleware/authMiddleware");

// Save chosen reply
router.patch("/:id/chosen", authMiddleware, saveChosenReply);

module.exports = router;