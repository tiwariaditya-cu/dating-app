const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
email: {
type: String,
required: true,
unique: true,
trim: true,
lowercase: true
},
password: {
type: String,
default: null
},
provider: {
type: String,
enum: ["local", "google"],
default: "local"
},
googleId: {
type: String,
index: true,
sparse: true
},
name: {
type: String,
trim: true,
default: ""
},
avatarUrl: {
type: String,
default: ""
},
createdAt: {
type: Date,
default: Date.now
}
});

module.exports = mongoose.model("User", userSchema);
