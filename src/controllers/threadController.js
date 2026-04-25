const Thread = require("../models/Thread");
const Message = require("../models/Message");

/**
 * @desc Create a new thread
 * @route POST /api/threads
 */
exports.createThread = async (req, res) => {
  try {
    const { personNickname } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!personNickname) {
      return res.status(400).json({ message: "personNickname is required" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized: User not found in token" });
    }

    const thread = new Thread({
      userId,
      personNickname,
      lastActiveAt: new Date(),
    });

    await thread.save();

    res.status(201).json(thread);
  } catch (error) {
    console.error("Create Thread Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * @desc Get all threads for logged-in user
 * @route GET /api/threads
 */
exports.getAllThreads = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    const threads = await Thread.find({ userId }).sort({ lastActiveAt: -1 }).lean();
    const enrichedThreads = await Promise.all(
      threads.map(async (thread) => {
        const lastChosenMessage = await Message.findOne({
          threadId: thread._id,
          chosenReply: { $nin: [null, ""] },
        })
          .sort({ createdAt: -1 })
          .select("chosenReply extractedText userContext tone replyStyles createdAt")
          .lean();

        if (!lastChosenMessage) {
          return thread;
        }

        return {
          ...thread,
          lastPreview: lastChosenMessage.chosenReply,
          lastTone: lastChosenMessage.tone,
          lastVibe: lastChosenMessage.replyStyles?.[0] || lastChosenMessage.tone,
          lastMessageAt: lastChosenMessage.createdAt,
        };
      })
    );

    res.status(200).json(enrichedThreads);
  } catch (error) {
    console.error("Get All Threads Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * @desc Get single thread + last 10 messages
 * @route GET /api/threads/:id
 */
exports.getThreadById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;

    const thread = await Thread.findOne({
      _id: id,
      userId,
    });

    if (!thread) {
      return res.status(404).json({ message: "Thread not found" });
    }

    const messages = await Message.find({
      threadId: id,
      chosenReply: { $nin: [null, ""] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("-generatedReplies");

    res.status(200).json({
      thread,
      messages: messages.reverse(), // oldest → newest
    });
  } catch (error) {
    console.error("Get Thread By ID Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
