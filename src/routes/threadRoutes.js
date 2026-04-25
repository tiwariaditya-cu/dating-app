const express = require("express");
const router = express.Router();

const {
  createThread,
  getAllThreads,
  getThreadById,
} = require("../controllers/threadController");

const authMiddleware = require("../middleware/authMiddleware");

// All routes are protected
router.post("/", authMiddleware, createThread);
router.get("/", authMiddleware, getAllThreads);
router.get("/:id", authMiddleware, getThreadById);

module.exports = router;