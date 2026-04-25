  // const OpenAI = require("openai");

  // const client = new OpenAI({
  //   apiKey: process.env.OPENAI_API_KEY,
  // });

  // function formatMessages(messages = []) {
  //   return messages
  //     .map((msg) => `${msg.speaker}: ${msg.text}`)
  //     .join("\n");
  // }

  // function safeParseReplies(content) {
  //   try {
  //     const parsed = JSON.parse(content);

  //     if (
  //       parsed &&
  //       Array.isArray(parsed.replies) &&
  //       parsed.replies.length === 3
  //     ) {
  //       return parsed.replies;
  //     }
  //   } catch (err) {
  //     // fallthrough
  //   }

  //   // Fallback responses (safe defaults)
  //   return [
  //     "Haha I didn’t expect that 😄",
  //     "That’s interesting, tell me more?",
  //     "I like where this is going 👀",
  //   ];
  // }

  // async function generateReplies({
  //   threadSummary,
  //   recentMessages,
  //   extractedText,
  //   userContext,
  //   tone,
  //   intensity,
  // }) {
  //   try {
  //     const formattedMessages = formatMessages(recentMessages);

  //     const systemPrompt = `You are a dating chat assistant. Help the user craft replies to their match.
  // Always return exactly 3 replies as valid JSON.
  // Keep replies natural, conversational, under 2 sentences each.`;

  //     const userPrompt = `
  // THREAD SUMMARY: ${threadSummary || "No history yet"}
  // RECENT MESSAGES: ${formattedMessages}
  // NEW MESSAGE: ${extractedText}
  // USER CONTEXT: ${userContext || "None provided"}
  // INSTRUCTION: Generate 3 replies in a ${tone} tone. Intensity: ${intensity}/10. Where 1 = barely noticeable, 10 = extremely ${tone}.
  // Return only: {"replies": ["reply1", "reply2", "reply3"]}
  // `;

  //     const response = await client.chat.completions.create({
  //       model: "gpt-4o",
  //       messages: [
  //         { role: "system", content: systemPrompt },
  //         { role: "user", content: userPrompt },
  //       ],
  //       temperature: 0.8,
  //     });

  //     const content = response.choices[0]?.message?.content?.trim();

  //     return safeParseReplies(content);
  //   } catch (error) {
  //     console.error("LLM Error:", error.message);

  //     return [
  //       "Haha I didn’t expect that 😄",
  //       "That’s interesting, tell me more?",
  //       "I like where this is going 👀",
  //     ];
  //   }
  // }

  // module.exports = {
  //   generateReplies,
  // };

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
 
function safeParseReplies(text) {
  try {
    // strip markdown code fences if Gemini wraps response in ```json ... ```
    const clean  = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
 
    if (
      parsed &&
      Array.isArray(parsed.replies) &&
      parsed.replies.length === 3
    ) {
      return parsed.replies;
    }
  } catch (err) {
    // fallthrough to defaults
  }
 
  return [
    "Haha I didn't expect that 😄",
    "That's interesting, tell me more?",
    "I like where this is going 👀",
  ];
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
  try {
    const formattedMessages = formatMessages(recentMessages);
 
    const prompt = `You are a dating chat assistant. Help the user craft replies to their match.
Always return exactly 3 replies as valid JSON — no extra text, no markdown, just the JSON.
Keep replies natural, conversational, under 2 sentences each.
 
THREAD SUMMARY: ${threadSummary || "No history yet"}
RECENT MESSAGES: ${formattedMessages || "None"}
NEW MESSAGE: ${extractedText || "None"}
USER CONTEXT: ${userContext || "None provided"}
STYLE DETAILS: ${replyStyles.length ? replyStyles.join(", ") : "None selected"}
 
INSTRUCTION: Generate 3 replies in a ${tone} tone.
Intensity: ${intensity}/10. Where 1 = barely noticeable, 10 = extremely ${tone}.
Apply the selected style details naturally. If "low effort" is selected, keep it casual and short, not dismissive. If "ask a question" is selected, include a natural question in each option. If "no question" is selected, do not end any option with a question.
 
Return only this exact format:
{"replies": ["reply1", "reply2", "reply3"]}`;
 
    const text = await generateGeminiText(prompt);
 
    console.log("Gemini raw response:", text); // helpful for debugging
 
    return safeParseReplies(text);
 
  } catch (error) {
    console.error("LLM Error:", error.message);
 
    return [
      "Haha I didn't expect that 😄",
      "That's interesting, tell me more?",
      "I like where this is going 👀",
    ];
  }
}
 
module.exports = { generateReplies };
