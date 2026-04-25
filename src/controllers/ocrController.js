const { extractTextFromImage } = require("../services/ocrService");

const ocrController = async (req, res) => {
  try {
    const { image, languageHints } = req.body;

    if (!image) {
      return res.status(400).json({
        message: "Image is required",
      });
    }

    const ocrResult = await extractTextFromImage(image, { languageHints });

    return res.status(200).json({
      lastMessageFromThem: ocrResult.lastMessageFromThem || "",
      extractedText: ocrResult.extractedText,
      cleanedText: ocrResult.cleanedText || ocrResult.extractedText || "",
      messages: ocrResult.messages,
      rawExtractedText: ocrResult.rawExtractedText || "",
    });
  } catch (error) {
    console.error("OCR Controller Error:", error.message);

    return res.status(500).json({
      message: "Something went wrong",
    });
  }
};

module.exports = {
  ocrController,
};
