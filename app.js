const dotenv = require("dotenv");

dotenv.config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const ocrRoutes = require("./src/routes/ocrRoutes");
const generateRoutes = require("./src/routes/generateRoutes");

const threadRoutes = require("./src/routes/threadRoutes");
const messageRoutes = require("./src/routes/messageRoutes");

const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const rateLimiter = require("./src/middleware/rateLimiter");

// Initialize app
const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "15mb";
const configuredOrigins = [
  process.env.PUBLIC_APP_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ALLOWED_ORIGINS,
]
  .filter(Boolean)
  .join(",")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Connect DB
connectDB();

// Middleware
const allowedOrigins = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  ...configuredOrigins,
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
}));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(rateLimiter);


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/threads", threadRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api", ocrRoutes);
app.use("/api", generateRoutes);
app.use(express.static(path.join(__dirname, "frontend")));

// Health check
app.get("/health", (req, res) => {
res.status(200).json({ status: "ok" });
});

app.use((err, req, res, next) => {
if (err?.type === "entity.too.large") {
return res.status(413).json({
message: `Image upload is too large. Try a smaller screenshot or set JSON_BODY_LIMIT above ${JSON_BODY_LIMIT}.`,
});
}

if (err instanceof SyntaxError && "body" in err) {
return res.status(400).json({ message: "Request body is not valid JSON." });
}

return next(err);
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});


