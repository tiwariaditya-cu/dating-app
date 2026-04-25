const rateLimit = require("express-rate-limit");

const rateLimiter = rateLimit({
windowMs: 60 * 1000, // 1 minute
max: 20, // limit each IP to 20 requests per window
message: {
message: "Too many requests, please try again later."
},
standardHeaders: true,
legacyHeaders: false
});

module.exports = rateLimiter;
 