const Message = require("../models/Message");
const Thread = require("../models/Thread");
const { generateGeminiText } = require("./geminiService");
 
function formatMessages(messages = []) {
  return messages
    .map((msg) => {
      const parts = [];

      if (msg.extractedText) {
        parts.push(`Conversation: ${msg.extractedText}`);
      }

      if (msg.userContext) {
        parts.push(`User context: ${msg.userContext}`);
      }

      if (msg.chosenReply) {
        parts.push(`Chosen reply: ${msg.chosenReply}`);
      }

      if (Array.isArray(msg.replyStyles) && msg.replyStyles.length) {
        parts.push(`Style details: ${msg.replyStyles.join(", ")}`);
      }

      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}
 
async function compressMemoryIfNeeded(threadId) {
  try {
    const messageCount = await Message.countDocuments({ threadId });
 
    // Only compress at 10, 20, 30...
    if (messageCount % 10 !== 0) {
      return;
    }
 
    const messages = await Message.find({ threadId })
      .sort({ createdAt: -1 })
      .limit(10);
 
    const orderedMessages = messages.reverse(); // oldest → newest
    const formatted = formatMessages(orderedMessages);
 
    const prompt = `Summarize this dating app conversation in 1 short paragraph under 100 words. Focus on who these people are, what they have talked about, the vibe between them, and any important details.
 
${formatted}`;
 
    const summary = (await generateGeminiText(prompt))?.trim();
 
    if (!summary) return;
 
    await Thread.findByIdAndUpdate(threadId, { summary });
 
    console.log("Memory compressed for thread:", threadId);
  } catch (error) {
    console.error("Memory compression error:", error.publicMessage || error.message);
  }
}
 
module.exports = { compressMemoryIfNeeded };
