const express = require("express");
const router = express.Router();

const { register, login, googleLogin, getGoogleConfig } = require("../controllers/authController");

router.get("/google/config", getGoogleConfig);

// Register route
router.post("/register", register);

// Login route
router.post("/login", login);

// Google sign-in route
router.post("/google", googleLogin);

module.exports = router;
