const axios = require("axios");
const sharp = require("sharp");

const OCR_URL = "https://vision.googleapis.com/v1/images:annotate";
const MIN_BASE64_LENGTH = 1000;
const OCR_TIMEOUT_MS = 15000;
const MAX_REQUEST_BASE64_CHARS = 10 * 1024 * 1024;
const SUPPORTED_DATA_URI_PREFIX = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
const SHOULD_LOG_RAW_VISION_RESPONSE = process.env.OCR_DEBUG === "true";
const DEFAULT_LANGUAGE_HINTS = (process.env.OCR_LANGUAGE_HINTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const OCR_FEATURE_PRIORITY = ["DOCUMENT_TEXT_DETECTION", "TEXT_DETECTION"];
const OCR_MIN_SCORE = Number(process.env.OCR_MIN_SCORE || 45);
const OCR_MIN_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE || 0.45);
const DAY_LINE_PATTERN =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)(?:\s+\d{1,2}:\d{2}\s*(am|pm)?)?$/i;
const TIME_LINE_PATTERN = /^\d{1,2}:\d{2}\s*(am|pm)$/i;
const MATCH_BANNER_PATTERN = /^you matched with\b/i;
const STATUS_LINE_PATTERN = /^(sent|delivered|read|typing|message|messages)$/i;

const log = {
  debug: (...args) => console.log("[OCR]", ...args),
  warn: (...args) => console.warn("[OCR]", ...args),
  error: (...args) => console.error("[OCR]", ...args),
};

function getPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }

  return {
    format: "png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getGifDimensions(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }

  return {
    format: "gif",
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function getJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && offset + 7 < buffer.length) {
      return {
        format: "jpeg",
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return {
    format: "jpeg",
  };
}

function getImageMetadata(buffer, mimeType) {
  const pngMetadata = getPngDimensions(buffer);
  if (pngMetadata) {
    return pngMetadata;
  }

  const jpegMetadata = getJpegDimensions(buffer);
  if (jpegMetadata) {
    return jpegMetadata;
  }

  const gifMetadata = getGifDimensions(buffer);
  if (gifMetadata) {
    return gifMetadata;
  }

  return {
    format: mimeType || "unknown",
  };
}

function normalizeBase64Image(base64Image) {
  if (typeof base64Image !== "string") {
    return {
      ok: false,
      reason: "OCR input must be a base64 string.",
    };
  }

  const trimmedInput = base64Image.trim();

  if (!trimmedInput) {
    return {
      ok: false,
      reason: "OCR input is an empty string.",
    };
  }

  const prefixMatch = trimmedInput.match(SUPPORTED_DATA_URI_PREFIX);
  const mimeType = prefixMatch?.[1] || null;
  const strippedPrefix = prefixMatch ? trimmedInput.replace(SUPPORTED_DATA_URI_PREFIX, "") : trimmedInput;
  const normalizedBase64 = strippedPrefix.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");

  if (normalizedBase64.length < MIN_BASE64_LENGTH) {
    return {
      ok: false,
      reason: `Base64 payload is too small (${normalizedBase64.length} chars).`,
      details: {
        mimeType,
        inputLength: trimmedInput.length,
        normalizedLength: normalizedBase64.length,
      },
    };
  }

  if (!BASE64_PATTERN.test(normalizedBase64)) {
    return {
      ok: false,
      reason: "Base64 payload contains invalid characters.",
      details: {
        mimeType,
        inputLength: trimmedInput.length,
        normalizedLength: normalizedBase64.length,
      },
    };
  }

  const imageBuffer = Buffer.from(normalizedBase64, "base64");

  if (!imageBuffer.length) {
    return {
      ok: false,
      reason: "Base64 payload could not be decoded into image bytes.",
      details: {
        mimeType,
        inputLength: trimmedInput.length,
        normalizedLength: normalizedBase64.length,
      },
    };
  }

  if (imageBuffer.length < 100) {
    return {
      ok: false,
      reason: "Decoded image is too small to be valid.",
    };
  }

  const normalizedWithoutPadding = normalizedBase64.replace(/=+$/, "");
  const reEncodedWithoutPadding = imageBuffer.toString("base64").replace(/=+$/, "");

  if (normalizedWithoutPadding !== reEncodedWithoutPadding) {
    return {
      ok: false,
      reason: "Base64 payload looks corrupted after decode/encode validation.",
      details: {
        mimeType,
        inputLength: trimmedInput.length,
        normalizedLength: normalizedBase64.length,
      },
    };
  }

  return {
    ok: true,
    buffer: imageBuffer,
    cleanedBase64: normalizedBase64,
    mimeType,
    inputLength: trimmedInput.length,
    normalizedLength: normalizedBase64.length,
    decodedBytes: imageBuffer.length,
    imageMetadata: getImageMetadata(imageBuffer, mimeType),
  };
}

function normalizeLanguageHints(languageHints) {
  if (typeof languageHints === "string") {
    return languageHints
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(languageHints)) {
    return DEFAULT_LANGUAGE_HINTS;
  }

  return languageHints.map((value) => String(value).trim()).filter(Boolean);
}

function createVisionPayload(cleanedBase64, featureType, languageHints) {
  const normalizedLanguageHints = normalizeLanguageHints(languageHints);

  return {
    requests: [
      {
        image: {
          content: cleanedBase64,
        },
        features: [
          {
            type: featureType,
          },
        ],
        imageContext: {
          languageHints: normalizedLanguageHints,
          textDetectionParams: {
            enableTextDetectionConfidenceScore: true,
          },
        },
      },
    ],
  };
}

function getVisionErrorMessage(visionError) {
  if (!visionError) {
    return null;
  }

  const status = visionError.status || visionError.code || "UNKNOWN";
  const message = visionError.message || "Vision API returned an error.";

  return `${status}: ${message}`;
}

function getVisionRequestErrorInfo(error) {
  const visionError = error?.response?.data?.error;

  return {
    status: visionError?.status || error?.code || "UNKNOWN_ERROR",
    message: visionError?.message || error.message || "Unexpected OCR error.",
    payload: error?.response?.data || null,
  };
}

function logImageDiagnostics(metadata) {
  log.debug(
    "Normalized image payload:",
    JSON.stringify({
      mimeType: metadata.mimeType,
      hadPrefix: Boolean(metadata.mimeType),
      inputLength: metadata.inputLength,
      normalizedLength: metadata.normalizedLength,
      decodedBytes: metadata.decodedBytes,
      imageMetadata: metadata.imageMetadata,
    })
  );

  const { width, height } = metadata.imageMetadata || {};

  if (metadata.normalizedLength > MAX_REQUEST_BASE64_CHARS) {
    log.warn(
      `Base64 payload is very large (${metadata.normalizedLength} chars). Vision REST requests have a 10MB JSON limit.`
    );
  }

  if (typeof width === "number" && typeof height === "number") {
    if (width < 1024 || height < 768) {
      log.warn(`Image resolution is ${width}x${height}. Low-resolution screenshots often produce OCR gibberish.`);
    }
  } else {
    log.warn("Could not determine image dimensions from the base64 payload. Inspect screenshot clarity if OCR stays noisy.");
  }
}

function getVerticesBounds(vertices = []) {
  const xs = vertices.map((vertex) => Number(vertex?.x || 0));
  const ys = vertices.map((vertex) => Number(vertex?.y || 0));

  return {
    xMin: xs.length ? Math.min(...xs) : 0,
    xMax: xs.length ? Math.max(...xs) : 0,
    yMin: ys.length ? Math.min(...ys) : 0,
    yMax: ys.length ? Math.max(...ys) : 0,
  };
}

function getWordText(word) {
  return (word?.symbols || []).map((symbol) => symbol.text || "").join("");
}

function getWordBreakType(word) {
  const symbols = word?.symbols || [];
  const lastSymbol = symbols[symbols.length - 1];
  return lastSymbol?.property?.detectedBreak?.type || null;
}

function getWordConfidence(word) {
  if (typeof word?.confidence === "number") {
    return word.confidence;
  }

  const symbolConfidences = (word?.symbols || [])
    .map((symbol) => symbol.confidence)
    .filter((value) => typeof value === "number");

  if (!symbolConfidences.length) {
    return null;
  }

  const total = symbolConfidences.reduce((sum, value) => sum + value, 0);
  return total / symbolConfidences.length;
}

function normalizeLineText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\bi\b/g, "I")
    .replace(/\bi'm\b/gi, "I'm")
    .replace(/\bi've\b/gi, "I've")
    .replace(/\bi'll\b/gi, "I'll")
    .replace(/\bidk\b/gi, "idk")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildLinesFromAnnotation(annotateResponse) {
  const pages = annotateResponse?.fullTextAnnotation?.pages || [];
  const lines = [];
  let imageWidth = 0;
  let imageHeight = 0;

  for (const page of pages) {
    imageWidth = Math.max(imageWidth, Number(page?.width || 0));
    imageHeight = Math.max(imageHeight, Number(page?.height || 0));

    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        let currentWords = [];

        const flushLine = () => {
          if (!currentWords.length) {
            return;
          }

          const texts = currentWords.map((entry) => entry.text).filter(Boolean);
          const xsMin = currentWords.map((entry) => entry.xMin);
          const xsMax = currentWords.map((entry) => entry.xMax);
          const ysMin = currentWords.map((entry) => entry.yMin);
          const ysMax = currentWords.map((entry) => entry.yMax);
          const confidences = currentWords
            .map((entry) => entry.confidence)
            .filter((value) => typeof value === "number");

          lines.push({
            text: normalizeLineText(texts.join(" ")),
            xMin: Math.min(...xsMin),
            xMax: Math.max(...xsMax),
            yMin: Math.min(...ysMin),
            yMax: Math.max(...ysMax),
            centerX: (Math.min(...xsMin) + Math.max(...xsMax)) / 2,
            centerY: (Math.min(...ysMin) + Math.max(...ysMax)) / 2,
            height: Math.max(...ysMax) - Math.min(...ysMin),
            width: Math.max(...xsMax) - Math.min(...xsMin),
            confidence: confidences.length
              ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
              : null,
          });

          currentWords = [];
        };

        for (const word of paragraph.words || []) {
          const text = getWordText(word);
          if (!text) {
            continue;
          }

          const bounds = getVerticesBounds(word.boundingBox?.vertices);
          currentWords.push({
            text,
            confidence: getWordConfidence(word),
            ...bounds,
          });

          const breakType = getWordBreakType(word);
          if (
            breakType === "LINE_BREAK" ||
            breakType === "EOL_SURE_SPACE" ||
            breakType === "SURE_SPACE"
          ) {
            flushLine();
          }
        }

        flushLine();
      }
    }
  }

  return {
    lines: lines.filter((line) => line.text),
    imageWidth,
    imageHeight,
  };
}

function getAverageSymbolConfidence(fullTextAnnotation) {
  const symbolConfidences = [];

  for (const page of fullTextAnnotation?.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          for (const symbol of word.symbols || []) {
            if (typeof symbol.confidence === "number") {
              symbolConfidences.push(symbol.confidence);
            }
          }
        }
      }
    }
  }

  if (!symbolConfidences.length) {
    return null;
  }

  const total = symbolConfidences.reduce((sum, confidence) => sum + confidence, 0);
  return total / symbolConfidences.length;
}

function extractTextFromVisionResponse(responseData) {
  const annotateResponse = responseData?.responses?.[0];

  if (!annotateResponse) {
    return {
      text: "",
      source: null,
      reason: "Vision response did not include responses[0].",
      confidence: null,
      annotateResponse: null,
    };
  }

  if (annotateResponse.error) {
    return {
      text: "",
      source: null,
      reason: getVisionErrorMessage(annotateResponse.error),
      confidence: null,
      annotateResponse,
    };
  }

  const averageConfidence = getAverageSymbolConfidence(annotateResponse.fullTextAnnotation);
  const fullText = annotateResponse.fullTextAnnotation?.text;
  if (typeof fullText === "string" && fullText.trim()) {
    return {
      text: fullText.trim(),
      source: "fullTextAnnotation.text",
      reason: null,
      confidence: averageConfidence,
      annotateResponse,
    };
  }

  const fallbackText = annotateResponse.textAnnotations?.[0]?.description;
  if (typeof fallbackText === "string" && fallbackText.trim()) {
    return {
      text: fallbackText.trim(),
      source: "textAnnotations[0].description",
      reason: null,
      confidence: averageConfidence,
      annotateResponse,
    };
  }

  if (Object.keys(annotateResponse).length === 0) {
    return {
      text: "",
      source: null,
      reason: "Vision returned responses[0] as an empty object, which usually means no readable text was detected.",
      confidence: null,
      annotateResponse,
    };
  }

  return {
    text: "",
    source: null,
    reason: "Vision response succeeded but did not include OCR text fields.",
    confidence: averageConfidence,
    annotateResponse,
  };
}

function cleanExtractedText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForDeduplication(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSpeaker(line, imageWidth) {
  if (!imageWidth) {
    return "unknown";
  }

  const leftRatio = line.xMin / imageWidth;
  const rightRatio = line.xMax / imageWidth;
  const centerRatio = line.centerX / imageWidth;

  if (leftRatio >= 0.42 || centerRatio >= 0.62) {
    return "you";
  }

  if (rightRatio <= 0.68 || centerRatio <= 0.45) {
    return "them";
  }

  return "unknown";
}

function mergeStructuredLines(lines, imageWidth) {
  const messages = [];

  for (const line of lines) {
    const speaker = inferSpeaker(line, imageWidth);
    const previous = messages[messages.length - 1];

    if (
      previous &&
      previous.speaker === speaker &&
      Math.abs(previous.yMax - line.yMin) <= Math.max(24, line.height * 1.5)
    ) {
      previous.text = `${previous.text} ${line.text}`.replace(/\s+/g, " ").trim();
      previous.yMax = Math.max(previous.yMax, line.yMax);
      previous.xMin = Math.min(previous.xMin, line.xMin);
      previous.xMax = Math.max(previous.xMax, line.xMax);
      continue;
    }

    messages.push({
      speaker,
      text: line.text,
      xMin: line.xMin,
      xMax: line.xMax,
      yMin: line.yMin,
      yMax: line.yMax,
    });
  }

  return messages.filter((message) => message.text).map((message) => ({
    speaker: message.speaker,
    text: normalizeLineText(message.text),
  }));
}

function isHeavyUiArtifact(line) {
  const alphanumericCount = (line.match(/[a-z0-9]/gi) || []).length;
  const symbolCount = (line.match(/[^a-z0-9\s]/gi) || []).length;

  if (alphanumericCount === 0) {
    return true;
  }

  return symbolCount > alphanumericCount;
}

function isNoiseLine(line) {
  if (!line) {
    return true;
  }

  const unlabeledLine = line.replace(/^(you|them)\s*:\s*/i, "").trim();

  if (!unlabeledLine) {
    return true;
  }

  if (MATCH_BANNER_PATTERN.test(unlabeledLine)) {
    return true;
  }

  if (DAY_LINE_PATTERN.test(unlabeledLine) || TIME_LINE_PATTERN.test(unlabeledLine)) {
    return true;
  }

  if (STATUS_LINE_PATTERN.test(unlabeledLine)) {
    return true;
  }

  if (/matched/.test(unlabeledLine)) {
    return true;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(unlabeledLine)) {
    return true;
  }

  if (/^[+\u2713\u2714\u2715\u00D7<>\u2022\u00B7|]+$/.test(unlabeledLine)) {
    return true;
  }

  if (/^[a-z]{0,2}\d{0,2}$/i.test(unlabeledLine) && unlabeledLine.length <= 3) {
    return true;
  }

  if (isHeavyUiArtifact(unlabeledLine)) {
    return true;
  }

  return false;
}

function normalizeOCRLines(text) {
  const lines = cleanExtractedText(text)
    .toLowerCase()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // OCR often starts with the chat partner's display name before the actual conversation.
  if (lines.length && /^[a-z][a-z0-9_ ]{0,20}$/.test(lines[0]) && !lines[0].includes(" ")) {
    return lines.slice(1);
  }

  return lines;
}

function mergeBrokenMessageLines(lines) {
  const merged = [];

  for (const line of lines) {
    const hasSpeakerPrefix = /^(you|them)\s*:/i.test(line);

    if (hasSpeakerPrefix || !merged.length) {
      merged.push(line);
      continue;
    }

    merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
  }

  return merged;
}

function inferMessagesFromMergedLines(lines) {
  const messages = [];
  let fallbackSpeaker = "them";
  let lastExplicitSpeaker = null;

  for (const line of lines) {
    const match = line.match(/^(you|them)\s*:\s*(.*)$/i);
    let speaker;
    let text;

    if (match) {
      speaker = match[1].toLowerCase();
      text = match[2].trim();
      lastExplicitSpeaker = speaker;
      fallbackSpeaker = speaker === "you" ? "them" : "you";
    } else {
      speaker = lastExplicitSpeaker ? (lastExplicitSpeaker === "you" ? "them" : "you") : fallbackSpeaker;
      text = line.trim();
      fallbackSpeaker = speaker === "you" ? "them" : "you";
    }

    text = normalizeLineText(text).toLowerCase();
    if (!text || isNoiseLine(text)) {
      continue;
    }

    const normalized = normalizeForDeduplication(text);
    const previous = messages[messages.length - 1];

    // Skip exact or near-exact duplicates so repeated OCR lines do not pollute the result.
    if (previous) {
      const previousNormalized = normalizeForDeduplication(previous.text);

      if (normalized === previousNormalized || normalized.includes(previousNormalized) || previousNormalized.includes(normalized)) {
        continue;
      }
    }

    messages.push({
      speaker,
      text,
    });
  }

  return messages;
}

function parseOCRToChat(text) {
  try {
    const normalizedLines = normalizeOCRLines(text).filter((line) => !isNoiseLine(line));
    const mergedLines = mergeBrokenMessageLines(normalizedLines);
    const messages = inferMessagesFromMergedLines(mergedLines);
    const cleanedText = messages.map((message) => `${message.speaker}: ${message.text}`).join("\n");
    const lastMessageFromThem =
      [...messages].reverse().find((message) => message.speaker === "them")?.text || "";

    return {
      lastMessageFromThem,
      messages,
      cleanedText,
    };
  } catch (error) {
    log.warn("parseOCRToChat failed. Returning empty deterministic result.", error.message);
    return {
      lastMessageFromThem: "",
      messages: [],
      cleanedText: "",
    };
  }
}

function buildLabeledTextFromLayout(candidate) {
  const layout = buildLinesFromAnnotation(candidate.annotateResponse);
  const provisionalMessages = mergeStructuredLines(layout.lines, layout.imageWidth);

  return {
    labeledText: provisionalMessages
      .map((message) => {
        if (message.speaker === "you" || message.speaker === "them") {
          return `${message.speaker}: ${message.text}`;
        }

        return message.text;
      })
      .join("\n"),
    removedLineCount: Math.max(0, layout.lines.length - provisionalMessages.length),
  };
}

function structureCandidate(candidate) {
  const rawText = cleanExtractedText(candidate.text);
  const layoutText = buildLabeledTextFromLayout(candidate);
  const parserInput = layoutText.labeledText || rawText;
  const parsed = parseOCRToChat(parserInput);

  return {
    rawText,
    messages: parsed.messages,
    extractedText: parsed.cleanedText,
    cleanedText: parsed.cleanedText,
    lastMessageFromThem: parsed.lastMessageFromThem,
    removedLineCount: layoutText.removedLineCount,
  };
}

function getTextProfile(text) {
  const characters = text || "";
  const alphanumericCount = (characters.match(/[A-Za-z0-9]/g) || []).length;
  const letterCount = (characters.match(/[A-Za-z]/g) || []).length;
  const digitCount = (characters.match(/[0-9]/g) || []).length;
  const weirdSymbolCount = (characters.match(/[^A-Za-z0-9\s.,!?'"()\-:&/@]/g) || []).length;
  const words = characters.split(/\s+/).filter(Boolean);
  const alphabeticWords = words.filter((word) => /[A-Za-z]{2,}/.test(word));

  return {
    length: characters.length,
    wordCount: words.length,
    alphabeticWordCount: alphabeticWords.length,
    alphanumericCount,
    letterCount,
    digitCount,
    weirdSymbolCount,
  };
}

function scoreCandidateText(text, confidence, messageCount, labeledMessageCount) {
  if (!text) {
    return 0;
  }

  const profile = getTextProfile(text);
  const confidenceScore = typeof confidence === "number" ? confidence * 40 : 0;
  const digitPenalty = Math.max(0, profile.digitCount - profile.letterCount) * 1.5;

  return (
    profile.length * 0.6 +
    profile.wordCount * 8 +
    profile.alphabeticWordCount * 12 +
    profile.letterCount * 1.5 +
    confidenceScore +
    messageCount * 10 +
    labeledMessageCount * 12 -
    profile.weirdSymbolCount * 4 -
    digitPenalty
  );
}

function isProbablyUsefulResult(structuredResult, confidence) {
  if (!structuredResult.extractedText) {
    return false;
  }

  const profile = getTextProfile(structuredResult.extractedText);
  const labeledMessageCount = structuredResult.messages.filter((message) => message.speaker !== "unknown").length;
  const score = scoreCandidateText(
    structuredResult.extractedText,
    confidence,
    structuredResult.messages.length,
    labeledMessageCount
  );

  if (score < OCR_MIN_SCORE) {
    return false;
  }

  if (typeof confidence === "number" && confidence < OCR_MIN_CONFIDENCE && profile.alphabeticWordCount < 2) {
    return false;
  }

  return structuredResult.messages.length > 0;
}

function chooseBestCandidate(candidates) {
  const successfulCandidates = candidates
    .filter((candidate) => candidate.text)
    .map((candidate) => {
      const structured = structureCandidate(candidate);
      const labeledMessageCount = structured.messages.filter((message) => message.speaker !== "unknown").length;

      return {
        ...candidate,
        structured,
        score: scoreCandidateText(
          structured.extractedText || structured.rawText,
          candidate.confidence,
          structured.messages.length,
          labeledMessageCount
        ),
      };
    })
    .filter((candidate) => candidate.structured.extractedText || candidate.structured.rawText);

  if (!successfulCandidates.length) {
    return null;
  }

  successfulCandidates.sort((left, right) => right.score - left.score);
  return successfulCandidates[0];
}

async function buildImageVariants(normalizedImage) {
  const variants = [
    {
      label: "original",
      cleanedBase64: normalizedImage.cleanedBase64,
    },
  ];

  try {
    const metadata = await sharp(normalizedImage.buffer).metadata();
    const targetWidth =
      typeof metadata.width === "number" && metadata.width < 1800
        ? Math.min(metadata.width * 2, 2400)
        : metadata.width || 1800;

    const enhancedBuffer = await sharp(normalizedImage.buffer)
      .rotate()
      .resize({
        width: targetWidth,
        withoutEnlargement: false,
      })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2, m1: 1, m2: 2 })
      .png()
      .toBuffer();

    variants.push({
      label: "enhanced",
      cleanedBase64: enhancedBuffer.toString("base64"),
    });

    const thresholdBuffer = await sharp(enhancedBuffer)
      .threshold(185)
      .png()
      .toBuffer();

    variants.push({
      label: "high-contrast",
      cleanedBase64: thresholdBuffer.toString("base64"),
    });
  } catch (error) {
    log.warn("Image preprocessing failed. Continuing with original image only.", error.message);
  }

  return variants;
}

async function callVision(cleanedBase64, featureType, languageHints, variantLabel) {
  const payload = createVisionPayload(cleanedBase64, featureType, languageHints);

  log.debug(
    "Vision request payload summary:",
    JSON.stringify({
      variant: variantLabel,
      requestCount: payload.requests.length,
      feature: payload.requests[0]?.features?.[0]?.type,
      contentLength: payload.requests[0]?.image?.content?.length,
      languageHints: payload.requests[0]?.imageContext?.languageHints || [],
    })
  );

  const response = await axios.post(`${OCR_URL}?key=${process.env.GOOGLE_VISION_API_KEY}`, payload, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: OCR_TIMEOUT_MS,
  });

  log.debug(`Vision API HTTP status for ${variantLabel}/${featureType}: ${response.status}`);

  if (SHOULD_LOG_RAW_VISION_RESPONSE) {
    log.debug(`Vision raw response for ${variantLabel}/${featureType}:`, JSON.stringify(response.data, null, 2));
  }

  const extracted = extractTextFromVisionResponse(response.data);
  return {
    ...extracted,
    featureType,
    variantLabel,
  };
}

async function extractTextFromImage(base64Image, options = {}) {
  try {
    if (!process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY === "your_api_key_here") {
      log.error("GOOGLE_VISION_API_KEY is missing or still set to the placeholder value.");
      return {
        lastMessageFromThem: "",
        extractedText: "",
        cleanedText: "",
        messages: [],
      };
    }

    const normalizedImage = normalizeBase64Image(base64Image);

    if (!normalizedImage.ok) {
      log.warn("Rejected OCR request before Vision call:", normalizedImage.reason, normalizedImage.details || {});
      return {
        lastMessageFromThem: "",
        extractedText: "",
        cleanedText: "",
        messages: [],
      };
    }

    logImageDiagnostics(normalizedImage);

    const variants = await buildImageVariants(normalizedImage);
    const candidates = [];

    for (const variant of variants) {
      for (const featureType of OCR_FEATURE_PRIORITY) {
        if (variant.cleanedBase64.length > MAX_REQUEST_BASE64_CHARS) {
          log.warn(
            `Skipping ${variant.label}/${featureType}; base64 payload is too large (${variant.cleanedBase64.length} chars).`
          );
          continue;
        }

        let extracted;

        try {
          extracted = await callVision(
            variant.cleanedBase64,
            featureType,
            options.languageHints,
            variant.label
          );
        } catch (error) {
          const errorInfo = getVisionRequestErrorInfo(error);
          log.warn(`Vision OCR failed for ${variant.label}/${featureType} [${errorInfo.status}]: ${errorInfo.message}`);
          continue;
        }

        if (extracted.reason) {
          log.warn(`Vision OCR returned no usable text for ${variant.label}/${featureType}:`, extracted.reason);
        } else {
          log.debug(
            `OCR candidate from ${variant.label}/${featureType}/${extracted.source}. Length: ${extracted.text.length}, confidence: ${
              typeof extracted.confidence === "number" ? extracted.confidence.toFixed(3) : "n/a"
            }`
          );
        }

        candidates.push(extracted);
      }
    }

    const bestCandidate = chooseBestCandidate(candidates);

    if (!bestCandidate) {
      log.warn("OCR could not extract any candidate text from any image variant.");
      return {
        lastMessageFromThem: "",
        extractedText: "",
        cleanedText: "",
        messages: [],
      };
    }

    if (!isProbablyUsefulResult(bestCandidate.structured, bestCandidate.confidence)) {
      log.warn(
        `Best OCR candidate looked unreliable. variant=${bestCandidate.variantLabel}, feature=${bestCandidate.featureType}, score=${bestCandidate.score.toFixed(
          1
        )}, confidence=${typeof bestCandidate.confidence === "number" ? bestCandidate.confidence.toFixed(3) : "n/a"}`
      );
      return {
        lastMessageFromThem: "",
        extractedText: "",
        cleanedText: "",
        messages: [],
      };
    }

    log.debug(
      `Selected OCR result from ${bestCandidate.variantLabel}/${bestCandidate.featureType}/${bestCandidate.source}. Score=${bestCandidate.score.toFixed(
        1
      )}, confidence=${typeof bestCandidate.confidence === "number" ? bestCandidate.confidence.toFixed(3) : "n/a"}, removedLines=${
        bestCandidate.structured.removedLineCount
      }, messageCount=${bestCandidate.structured.messages.length}`
    );

    return {
      lastMessageFromThem: bestCandidate.structured.lastMessageFromThem,
      extractedText: bestCandidate.structured.extractedText,
      cleanedText: bestCandidate.structured.cleanedText,
      messages: bestCandidate.structured.messages,
      rawExtractedText: bestCandidate.structured.rawText,
    };
  } catch (error) {
    const errorInfo = getVisionRequestErrorInfo(error);
    const errorStatus = errorInfo.status;
    const errorMessage = errorInfo.message;

    log.error(`Vision API request failed [${errorStatus}]: ${errorMessage}`);

    if (errorInfo.payload) {
      log.error("Vision API error payload:", JSON.stringify(errorInfo.payload, null, 2));
    }

    if (errorStatus === "INVALID_ARGUMENT") {
      log.warn("INVALID_ARGUMENT usually means the base64 payload is malformed, truncated, or not an image.");
    }

    if (errorStatus === "PERMISSION_DENIED") {
      log.warn("PERMISSION_DENIED usually means the API key is invalid, restricted, or Vision API is not enabled.");
    }

    return {
      lastMessageFromThem: "",
      extractedText: "",
      cleanedText: "",
      messages: [],
    };
  }
}

module.exports = {
  extractTextFromImage,
  parseOCRToChat,
};
