const dotenv = require("dotenv");

dotenv.config();

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

// Connect DB
connectDB();

// Middleware
app.use(cors({
  origin: "http://127.0.0.1:5500"
}));
app.use(cors());
app.use(express.json());
app.use(rateLimiter);


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/threads", threadRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api", ocrRoutes);
app.use("/api", generateRoutes);

// Health check
app.get("/health", (req, res) => {
res.status(200).json({ status: "ok" });
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});



