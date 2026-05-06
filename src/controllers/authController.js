const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const MIN_PASSWORD_LENGTH = 8;

function getGoogleClient() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(email);
}

function getPasswordIssue(password) {
  if (typeof password !== "string" || !password) {
    return "Password is required";
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number";
  }

  return null;
}

function signToken(user) {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

function sendAuthResponse(res, user, message = "Login successful") {
  return res.status(200).json({
    message,
    token: signToken(user),
    user: {
      id: user._id,
      email: user.email,
      name: user.name || "",
      avatarUrl: user.avatarUrl || "",
      provider: user.provider,
    },
  });
}

exports.getGoogleConfig = (req, res) => {
  return res.status(200).json({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
  });
};

exports.register = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    const passwordIssue = getPasswordIssue(password);
    if (passwordIssue) {
      return res.status(400).json({ message: passwordIssue });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "An account already exists for this email" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      email,
      password: hashedPassword,
      provider: "local",
    });

    return sendAuthResponse(res, user, "Account created successfully");
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ message: "Google sign-in is not configured" });
    }

    if (!credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }

    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);

    if (!payload?.email_verified || !isValidEmail(email)) {
      return res.status(401).json({ message: "Google account email could not be verified" });
    }

    const user = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          email,
          googleId: payload.sub,
          name: payload.name || "",
          avatarUrl: payload.picture || "",
          provider: "google",
        },
        $setOnInsert: {
          password: null,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return sendAuthResponse(res, user, "Google login successful");
  } catch (error) {
    return res.status(401).json({ message: "Google sign-in failed", error: error.message });
  }
};
