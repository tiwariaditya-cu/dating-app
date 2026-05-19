const { generateGeminiText } = require("./geminiService");

const FALLBACK_REPLIES_ENGLISH = [
  "damn okay, I was just busy",
  "nah I'm still interested, relax",
  "you panic fast huh",
];

const FALLBACK_REPLIES_HINGLISH = [
  "arre haan, bas thoda busy tha",
  "nahi nahi, interest toh hai",
  "tum itni jaldi panic kar leti ho",
];

const ROMAN_HINGLISH_WORDS = new Set([
  "acha",
  "accha",
  "aaj",
  "ab",
  "are",
  "arre",
  "bas",
  "bhi",
  "bol",
  "btw",
  "chalo",
  "dekh",
  "hai",
  "hain",
  "haan",
  "han",
  "ho",
  "hu",
  "hun",
  "kal",
  "kya",
  "kyu",
  "kyun",
  "mat",
  "mera",
  "meri",
  "mere",
  "nahi",
  "nahin",
  "nai",
  "par",
  "phir",
  "rha",
  "raha",
  "rahi",
  "tha",
  "thi",
  "the",
  "thik",
  "theek",
  "toh",
  "tum",
  "tu",
  "yaar",
]);

const FORBIDDEN_REPLY_PATTERNS = [
  /\bmy dear\b/i,
  /\bdramatic\b/i,
  /\bpronouncements?\b/i,
  /\bindeed\b/i,
  /\bquite\b/i,
  /\bdearest\b/i,
  /\bdarling\b/i,
  /\bto assume\b/i,
  /\bmy interest remains\b/i,
];

const STYLE_RULES = `STRICT STYLE RULES:
- Sound like real modern texting on Tinder, Bumble, Hinge, or Instagram DMs.
- Keep each reply short: 1-2 sentences max.
- Make replies casual, confident, playful, flirty, and human.
- Use contractions naturally.
- Occasional lowercase is okay.
- Match the language and script of the conversation. If the conversation is in English, reply in English. If it is Roman Hinglish, reply in natural Roman Hinglish. If it uses Hindi/Devanagari, Hindi or Hinglish is okay depending on the chat's vibe.
- Do not translate a Hinglish conversation into formal English unless the user context asks for English.
- Avoid poetic, formal, therapist-like, philosophical, AI-like, or roleplay-style wording.
- Do not use: my dear, dramatic, pronouncements, indeed, quite, dearest, darling.
- Do not overexplain.
- Do not sound defensive.
- Make all 3 options distinct. Do not repeat sentence structure or keywords.`;

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
      } else if (Array.isArray(msg.generatedReplies) && msg.generatedReplies.length) {
        parts.push(`Generated replies: ${msg.generatedReplies.join(" | ")}`);
      }

      if (Array.isArray(msg.replyStyles) && msg.replyStyles.length) {
        parts.push(`Style details: ${msg.replyStyles.join(", ")}`);
      }

      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function getLanguageProfile(text) {
  const value = String(text || "").toLowerCase();
  const devanagariCount = (value.match(/[\u0900-\u097F]/g) || []).length;
  const words = value.match(/[a-z]+/g) || [];
  const romanHinglishCount = words.filter((word) => ROMAN_HINGLISH_WORDS.has(word)).length;
  const romanHinglishRatio = words.length ? romanHinglishCount / words.length : 0;

  if (devanagariCount >= 4) {
    return {
      label: "Hindi or Hindi-English mix",
      fallbackReplies: FALLBACK_REPLIES_HINGLISH,
      instruction:
        "The conversation includes Hindi/Devanagari. Reply in the same casual language mix. Keep it natural, not formal Hindi.",
    };
  }

  if (romanHinglishCount >= 2 || romanHinglishRatio >= 0.18) {
    return {
      label: "Roman Hinglish",
      fallbackReplies: FALLBACK_REPLIES_HINGLISH,
      instruction:
        "The conversation is Roman Hinglish. Reply in natural Roman Hinglish using simple words like haan, kya, nahi, yaar, toh where they fit. Do not switch to polished English.",
    };
  }

  return {
    label: "English",
    fallbackReplies: FALLBACK_REPLIES_ENGLISH,
    instruction: "The conversation is English. Reply in natural casual English.",
  };
}

function parseReplies(text) {
  try {
    const clean = String(text || "")
      .replace(/```json|```/g, "")
      .trim()
      .replace(/^[^{]*/, "")
      .replace(/[^}]*$/, "");
    const parsed = JSON.parse(clean);

    if (
      parsed &&
      Array.isArray(parsed.replies) &&
      parsed.replies.length === 3
    ) {
      return parsed.replies;
    }
  } catch (err) {
    // Fall through to validation failure.
  }

  return null;
}

function sentenceCount(reply) {
  const matches = reply.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function hasRepeatedShape(replies) {
  const starts = replies.map((reply) =>
    reply
      .toLowerCase()
      .replace(/^[^a-z0-9]+/, "")
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")
  );

  return new Set(starts).size !== starts.length;
}

function isValidReply(reply) {
  if (typeof reply !== "string") return false;

  const trimmed = reply.trim();
  if (!trimmed) return false;
  if (trimmed.length > 150) return false;
  if (trimmed.split(/\s+/).length > 28) return false;
  if (sentenceCount(trimmed) > 2) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (FORBIDDEN_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;

  return true;
}

function validateReplies(replies) {
  if (!Array.isArray(replies) || replies.length !== 3) return null;

  const cleaned = replies.map((reply) => String(reply).trim());
  if (!cleaned.every(isValidReply)) return null;
  if (new Set(cleaned.map((reply) => reply.toLowerCase())).size !== 3) return null;
  if (hasRepeatedShape(cleaned)) return null;

  return cleaned;
}

async function generateValidReplies(prompt, fallbackReplies) {
  const text = await generateGeminiText(prompt);
  console.log("Gemini raw response:", text);

  const replies = validateReplies(parseReplies(text));
  if (replies) return replies;

  const retryPrompt = `${prompt}

Your previous output failed the JSON or style rules.
Rewrite it now. Keep the replies shorter, more casual, and more like fast phone texting. Keep the same language/script as the conversation.
Return only valid JSON:
{"replies":["reply1","reply2","reply3"]}`;

  const retryText = await generateGeminiText(retryPrompt);
  console.log("Gemini retry raw response:", retryText);

  return validateReplies(parseReplies(retryText)) || fallbackReplies;
}

async function generateReplies({
  threadSummary,
  recentMessages,
  extractedText,
  userContext,
  tone,
  intensity,
  replyStyles = [],
}) {
  let fallbackReplies = FALLBACK_REPLIES_ENGLISH;

  try {
    const formattedMessages = formatMessages(recentMessages);
    const languageProfile = getLanguageProfile(
      [threadSummary, formattedMessages, extractedText, userContext].filter(Boolean).join("\n")
    );
    fallbackReplies = languageProfile.fallbackReplies;

    const prompt = `You are generating realistic dating app replies.
Always return exactly 3 replies as valid JSON - no extra text, no markdown, just the JSON.

${STYLE_RULES}

THREAD SUMMARY: ${threadSummary || "No history yet"}
RECENT MESSAGES: ${formattedMessages || "None"}
NEW MESSAGE: ${extractedText || "None"}
USER CONTEXT: ${userContext || "None provided"}
STYLE DETAILS: ${replyStyles.length ? replyStyles.join(", ") : "None selected"}
LANGUAGE PROFILE: ${languageProfile.label}
LANGUAGE INSTRUCTION: ${languageProfile.instruction}

INSTRUCTION: Generate 3 replies in a ${tone} tone.
Intensity: ${intensity}/10. Where 1 = barely noticeable, 10 = extremely ${tone}.
Apply the selected style details naturally. If "low effort" is selected, keep it casual and short, not dismissive. If "ask a question" is selected, include a natural question in each option. If "no question" is selected, do not end any option with a question.

Return only this exact format:
{"replies": ["reply1", "reply2", "reply3"]}`;

    return generateValidReplies(prompt, languageProfile.fallbackReplies);
  } catch (error) {
    console.error("LLM Error:", error.publicMessage || error.message);
    return fallbackReplies;
  }
}

module.exports = { generateReplies };
