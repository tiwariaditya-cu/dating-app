const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
threadId: {
type: mongoose.Schema.Types.ObjectId,
ref: "Thread",
required: true
},
screenshotUrl: {
type: String,
default: null
},
userContext: {
type: String,
default: null
},
extractedText: {
type: String,
default: ""
},
tone: {
type: String,
enum: ["serious", "dramatic", "empathetic", "funny", "sarcastic"],
required: true
},
intensity: {
type: Number,
min: 1,
max: 10,
required: true
},
replyStyles: {
type: [String],
default: []
},
generatedReplies: {
type: [String],
required: true
},
chosenReply: {
type: String,
default: null
},
createdAt: {
type: Date,
default: Date.now
}
});

module.exports = mongoose.model("Message", messageSchema);
