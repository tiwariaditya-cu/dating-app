const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
].filter(Boolean);

function isMissingModelError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("is not supported for generateContent")
  );
}

async function generateGeminiText(prompt) {
  let lastError;

  for (const modelName of DEFAULT_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      lastError = error;

      if (!isMissingModelError(error)) {
        throw error;
      }

      console.warn(`Gemini model unavailable (${modelName}); trying fallback.`);
    }
  }

  throw lastError;
}

module.exports = { generateGeminiText };
