const { GoogleGenerativeAI } = require("@google/generative-ai");

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
].filter(Boolean);

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("GEMINI_API_KEY is not configured");
    error.publicMessage = "Gemini is not configured. Add GEMINI_API_KEY.";
    throw error;
  }

  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

function isMissingModelError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("is not supported for generateContent")
  );
}

function isAccessDeniedError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("403") ||
    message.includes("denied access") ||
    message.includes("API key not valid") ||
    message.includes("permission")
  );
}

function explainGeminiError(error) {
  if (isAccessDeniedError(error)) {
    error.publicMessage =
      "Gemini access was denied. Check that your GEMINI_API_KEY is active and Generative Language API access is allowed for that Google project.";
  }

  return error;
}

async function generateGeminiText(prompt) {
  let lastError;
  const genAI = getGeminiClient();

  for (const modelName of DEFAULT_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      lastError = error;

      if (!isMissingModelError(error)) {
        throw explainGeminiError(error);
      }

      console.warn(`Gemini model unavailable (${modelName}); trying fallback.`);
    }
  }

  throw explainGeminiError(lastError);
}

module.exports = { generateGeminiText };
