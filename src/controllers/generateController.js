const Thread = require("../models/Thread");
const Message = require("../models/Message");

const { extractTextFromImage } = require("../services/ocrService");
const { generateReplies } = require("../services/llmService");
const memoryService = require("../services/memoryService");

const ALLOWED_REPLY_STYLES = new Set([
  "flirty",
  "playful",
  "direct",
  "low effort",
  "confident",
  "ask a question",
  "no question",
]);

function normalizeExtractedText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return (
      value.cleanedText ||
      value.extractedText ||
      value.rawExtractedText ||
      value.lastMessageFromThem ||
      ""
    );
  }

  return String(value);
}

function normalizeReplyStyles(value) {
  if (!Array.isArray(value)) return [];

  const styles = value
    .map((style) => String(style).trim().toLowerCase())
    .filter((style) => ALLOWED_REPLY_STYLES.has(style));

  if (styles.includes("ask a question") && styles.includes("no question")) {
    return [...new Set(styles.filter((style) => style !== "ask a question"))];
  }

  return [...new Set(styles)];
}

exports.generateReplies = async (req, res) => {
  try {
    const { threadId, tone, intensity, image, extractedText, userContext } = req.body;
    const replyStyles = normalizeReplyStyles(req.body.replyStyles);

    // -------------------------------
    // STEP 1 — VALIDATION
    // -------------------------------
    if (!threadId || !tone || !intensity) {
      return res.status(400).json({
        message: "threadId, tone, and intensity are required",
      });
    }

    if (!image && !extractedText && !userContext) {
      return res.status(400).json({
        message: "Provide at least one of: image, extractedText, or userContext",
      });
    }

    // -------------------------------
    // STEP 2 — OCR
    // -------------------------------
    let finalExtractedText = normalizeExtractedText(extractedText);
    let ocrWarning = "";

    if (image) {
      try {
        const ocrResult = await extractTextFromImage(image);
        finalExtractedText = normalizeExtractedText(ocrResult);
        if (!finalExtractedText) {
          ocrWarning = "Could not read enough text from the screenshot. Generated replies may be generic.";
        }
      } catch (err) {
        console.error("OCR Error:", err.message);
        ocrWarning = "Screenshot OCR failed. Generated replies may be generic.";
      }
    }

    // -------------------------------
    // STEP 3 — LOAD THREAD + CONTEXT
    // -------------------------------
    const thread = await Thread.findOne({
      _id: threadId,
      userId: req.user.id,
    });

    if (!thread) {
      return res.status(404).json({
        message: "Thread not found or unauthorized",
      });
    }

    const lastMessages = await Message.find({ threadId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const threadSummary = thread.summary || "";

    // -------------------------------
    // STEP 4 — GENERATE REPLIES
    // -------------------------------
    let generatedReplies = [];

    try {
      generatedReplies = await generateReplies({
        threadSummary,
        recentMessages: lastMessages.reverse(), // oldest → newest
        extractedText: finalExtractedText,
        userContext,
        tone,
        intensity,
        replyStyles,
      });
    } catch (err) {
      console.error("LLM Error:", err.message);
      return res.status(500).json({
        message: "Failed to generate replies",
      });
    }

    // -------------------------------
    // STEP 5 — SAVE MESSAGE
    // -------------------------------
    const newMessage = await Message.create({
      threadId,
      userId: req.user.id,
      extractedText: finalExtractedText,
      userContext,
      tone,
      intensity,
      replyStyles,
      generatedReplies,
    });

    thread.lastActiveAt = new Date();
    await thread.save();

    // -------------------------------
    // STEP 6 — MEMORY COMPRESSION
    // -------------------------------
    try {
      await memoryService.compressMemoryIfNeeded(threadId);
    } catch (err) {
      console.error("Memory Compression Error:", err.message);
      // Don't fail request — non-blocking
    }

    // -------------------------------
    // STEP 7 — RESPONSE
    // -------------------------------
    return res.status(200).json({
      replies: generatedReplies,
      messageId: newMessage._id,
      ocrWarning,
    });

  } catch (error) {
    console.error("Generate Controller Error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
