const mongoose = require("mongoose");

const threadSchema = new mongoose.Schema({
userId: {
type: mongoose.Schema.Types.ObjectId,
ref: "User",
required: true
},
personNickname: {
type: String,
required: true,
trim: true
},
summary: {
type: String,
default: ""
},
lastActiveAt: {
type: Date,
default: Date.now
},
createdAt: {
type: Date,
default: Date.now
}
});

module.exports = mongoose.model("Thread", threadSchema);
