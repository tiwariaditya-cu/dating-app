const Message = require("../models/Message");

/**
 * @desc Save chosen reply for a message
 * @route PATCH /api/messages/:id/chosen
 */
exports.saveChosenReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { chosenReply } = req.body;

    if (!chosenReply) {
      return res.status(400).json({ message: "chosenReply is required" });
    }

    // Find message
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Optional but STRONGLY recommended: validate chosenReply exists in generatedReplies
    if (
      message.generatedReplies &&
      !message.generatedReplies.includes(chosenReply)
    ) {
      return res.status(400).json({
        message: "Invalid reply selection",
      });
    }

    message.chosenReply = chosenReply;

    await message.save();

    res.status(200).json({
      message: "Chosen reply saved successfully",
      data: message,
    });
  } catch (error) {
    console.error("Save Chosen Reply Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};