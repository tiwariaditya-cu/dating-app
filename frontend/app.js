const IS_FILE_PAGE = window.location.protocol === "file:";
const DEV_API_BASE = "http://localhost:5000";
const CONFIGURED_API_BASE = window.RIZZ_API_BASE || "";
const LOCAL_FRONTEND_PORTS = new Set(["5500", "5173", "3000"]);
const API_BASE = CONFIGURED_API_BASE || (IS_FILE_PAGE || LOCAL_FRONTEND_PORTS.has(window.location.port)
  ? DEV_API_BASE
  : window.location.origin);
const MAX_UPLOAD_DIMENSION = 2200;
const OPTIMIZE_UPLOAD_ABOVE_BYTES = 2 * 1024 * 1024;
const OPTIMIZED_UPLOAD_QUALITY = 0.9;

const views = {
  auth: document.getElementById("authView"),
  threads: document.getElementById("threadsView"),
  reply: document.getElementById("replyView"),
};

const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submitBtn");
const authError = document.getElementById("authError");
const googleSignInWrap = document.getElementById("googleSignInWrap");
const googleFallbackBtn = document.getElementById("googleFallbackBtn");
const googleStatus = document.getElementById("googleStatus");

const threadsContainer = document.getElementById("threadsContainer");
const addThreadBtn = document.getElementById("addThreadBtn");
const promoNewThreadBtn = document.getElementById("promoNewThreadBtn");
const threadModal = document.getElementById("threadModal");
const modalBackdrop = document.querySelector(".modal-backdrop");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const nicknameInput = document.getElementById("nicknameInput");
const createThreadBtn = document.getElementById("createThreadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const totalThreadsStat = document.getElementById("totalThreadsStat");
const activeThreadsStat = document.getElementById("activeThreadsStat");
const latestThreadStat = document.getElementById("latestThreadStat");

const backBtn = document.getElementById("backBtn");
const replyPersonName = document.getElementById("replyPersonName");
const toneButtons = document.querySelectorAll(".tone-btn");
const styleChips = document.querySelectorAll(".style-chip");
const toneDescription = document.getElementById("toneDescription");
const intensitySlider = document.getElementById("intensitySlider");
const intensityValue = document.getElementById("intensityValue");
const imageInput = document.getElementById("imageInput");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadPreview = document.getElementById("uploadPreview");
const previewImg = document.getElementById("previewImg");
const removeImgBtn = document.getElementById("removeImgBtn");
const contextInput = document.getElementById("contextInput");
const extraContextInput = document.getElementById("extraContextInput");
const generateBtn = document.getElementById("generateBtn");
const repliesContainer = document.getElementById("repliesContainer");
const historyContainer = document.getElementById("historyContainer");
const historyMeta = document.getElementById("historyMeta");
const uploadBox = document.getElementById("uploadBox");

let isLogin = true;
let selectedTone = null;
let selectedReplyStyles = [];
let base64Image = null;
let selectedThreadId = null;
let loadingTimers = [];
let cachedThreads = [];
let googleClientId = "";

const AV_GRADIENTS = [
  "linear-gradient(135deg,#E35D55,#FFB36C)",
  "linear-gradient(135deg,#B779E8,#F3A7C4)",
  "linear-gradient(135deg,#4F8F7B,#93D4A8)",
  "linear-gradient(135deg,#D49A2A,#FFD95A)",
  "linear-gradient(135deg,#5577C8,#83B6F4)",
];

function show(view) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  view.classList.add("active");
}

function getToken() {
  return localStorage.getItem("token");
}

function showError(msg) {
  authError.textContent = msg;
}

function clearError() {
  authError.textContent = "";
}

function setGoogleStatus(message, isError = false) {
  if (!googleStatus) return;
  googleStatus.textContent = message || "";
  googleStatus.classList.toggle("error", Boolean(isError));
}

function getGoogleOriginHint() {
  const origin = window.location.origin;
  const shortClientId = googleClientId ? `${googleClientId.slice(0, 12)}...${googleClientId.slice(-24)}` : "not loaded";
  if (IS_FILE_PAGE) {
    return "Open http://localhost:5000 to use Google sign-in. Google blocks sign-in from file pages.";
  }

  return `Google sign-in needs this exact origin in Google Cloud: ${origin}. Client: ${shortClientId}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || "").trim());
}

function getPasswordIssue(password) {
  if (!password) return "Please enter your password.";
  if (!isLogin && password.length < 8) return "Password needs at least 8 characters.";
  if (!isLogin && (!/[A-Za-z]/.test(password) || !/\d/.test(password))) {
    return "Password needs at least one letter and one number.";
  }
  return "";
}

async function readApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text();
  return {
    message: text || res.statusText || "Request failed.",
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This image format could not be opened in the browser."));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function optimizeUploadImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const largestSide = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);

  if (file.size <= OPTIMIZE_UPLOAD_ABOVE_BYTES && largestSide <= MAX_UPLOAD_DIMENSION) {
    return dataUrl;
  }

  const scale = Math.min(1, MAX_UPLOAD_DIMENSION / largestSide);
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", OPTIMIZED_UPLOAD_QUALITY);
  if (!blob) {
    return dataUrl;
  }

  return readFileAsDataUrl(blob);
}

function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AV_GRADIENTS[h % AV_GRADIENTS.length];
}

function timeAgo(d) {
  if (!d) return "new";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function formatDateTime(d) {
  if (!d) return "saved";
  return new Date(d).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTone(tone, intensity) {
  const cleanTone = tone ? String(tone) : "reply";
  return `${cleanTone}${intensity ? ` ${intensity}/10` : ""}`;
}

function formatStyleList(styles = []) {
  return Array.isArray(styles) && styles.length ? styles.join(", ") : "";
}

function getThreadPreview(thread) {
  return (
    thread.lastPreview ||
    thread.preview ||
    thread.summary ||
    "Start with a screenshot or a little context."
  );
}

function getPromptText(msg) {
  return msg.extractedText || msg.userContext || "";
}

function setGenerateLabel(text, loading = false) {
  generateBtn.textContent = text;
  generateBtn.classList.toggle("loading", loading);
}

function clearLoadingStages() {
  loadingTimers.forEach(clearTimeout);
  loadingTimers = [];
}

function clearComposer() {
  base64Image = null;

  if (contextInput) contextInput.value = "";
  if (extraContextInput) extraContextInput.value = "";
  if (imageInput) imageInput.value = "";
  if (previewImg) previewImg.src = "";
  uploadPlaceholder?.classList.remove("hidden");
  uploadPreview?.classList.add("hidden");
  repliesContainer.innerHTML = "";
  checkReady();
}

function startLoadingStages(hasImage) {
  clearLoadingStages();

  const stages = hasImage
    ? ["Reading screenshot", "Understanding the convo", "Writing replies"]
    : ["Understanding the convo", "Writing replies"];

  setGenerateLabel(stages[0], true);

  stages.slice(1).forEach((stage, index) => {
    loadingTimers.push(setTimeout(() => {
      setGenerateLabel(stage, true);
    }, (index + 1) * 1400));
  });
}

function renderHistory(messages = []) {
  if (!historyContainer) return;

  if (!messages.length) {
    if (historyMeta) historyMeta.textContent = "no chosen replies yet";
    historyContainer.innerHTML = `<div class="history-empty">Choose a reply to add it to this chat.</div>`;
    return;
  }

  if (historyMeta) {
    historyMeta.textContent = `${messages.length} chosen ${messages.length === 1 ? "reply" : "replies"}`;
  }

  const chosenMessages = messages.filter((msg) => msg.chosenReply);

  if (!chosenMessages.length) {
    if (historyMeta) historyMeta.textContent = "no chosen replies yet";
    historyContainer.innerHTML = `<div class="history-empty">Choose a reply to add it to this chat.</div>`;
    return;
  }

  historyContainer.innerHTML = chosenMessages.map((msg) => {
    const promptText = getPromptText(msg);
    const styleText = formatStyleList(msg.replyStyles);
    const metaParts = [formatTone(msg.tone, msg.intensity), styleText].filter(Boolean);

    return `
      <article class="chat-turn">
        ${promptText ? `
          <div class="chat-bubble incoming">
            <div class="chat-label">Their message / context</div>
            <div>${escapeHtml(promptText)}</div>
          </div>` : ""}
        <div class="chat-bubble outgoing">
          <div class="chat-label">Chosen reply</div>
          <div>${escapeHtml(msg.chosenReply)}</div>
        </div>
        <div class="chat-meta">
          <span>${formatDateTime(msg.createdAt)}</span>
          ${metaParts.length ? `<span>${escapeHtml(metaParts.join(" / "))}</span>` : ""}
        </div>
      </article>`;
  }).join("");
  historyContainer.scrollTop = historyContainer.scrollHeight;
}

function renderThreadStats() {
  const activeCount = cachedThreads.filter((thread) => thread.lastPreview || thread.lastMessageAt).length;
  const latest = cachedThreads[0]?.lastActiveAt || cachedThreads[0]?.createdAt;

  if (totalThreadsStat) totalThreadsStat.textContent = cachedThreads.length;
  if (activeThreadsStat) activeThreadsStat.textContent = activeCount;
  if (latestThreadStat) latestThreadStat.textContent = latest ? timeAgo(latest) : "new";
}

async function loadThreadHistory(threadId) {
  if (!historyContainer || !threadId) return;

  historyContainer.innerHTML = `<div class="history-loading">Loading saved replies...</div>`;
  if (historyMeta) historyMeta.textContent = "checking this thread";

  try {
    const res = await fetch(`${API_BASE}/api/threads/${threadId}`, {
      headers: { Authorization: "Bearer " + getToken() },
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      show(views.auth);
      return;
    }

    const data = await readApiResponse(res);

    if (!res.ok) {
      historyContainer.innerHTML = `<div class="history-empty">Could not load this thread's history.</div>`;
      return;
    }

    renderHistory(data.messages || []);
  } catch {
    historyContainer.innerHTML = `<div class="history-empty">History is offline right now.</div>`;
    if (historyMeta) historyMeta.textContent = "try again in a moment";
  }
}

function renderThreads() {
  const threads = cachedThreads;
  renderThreadStats();

  if (!cachedThreads.length) {
    threadsContainer.innerHTML = `
      <div class="threads-empty">
        <p>No chats yet. Add someone to start building replies with context.</p>
      </div>`;
    return;
  }

  threadsContainer.innerHTML = threads.map((t, i) => {
    const unreadCount = Number(t.unreadCount || 0);
    const unreadHtml = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : "";
    const name = t.personNickname || "Untitled";

    return `
      <button class="thread-card" type="button" style="animation-delay:${i * 0.04}s"
        onclick="openThread('${t._id}','${escapeAttr(name)}')">
        <div class="t-avatar" style="background:${avatarColor(name)}">
          ${escapeHtml(name.charAt(0).toUpperCase())}
        </div>
        <div class="t-main">
          <div class="t-row">
            <div class="t-name">${escapeHtml(name)}</div>
            ${unreadHtml}
          </div>
          <div class="t-preview">${escapeHtml(getThreadPreview(t))}</div>
        </div>
        <div class="t-meta">
          <span class="t-time">${timeAgo(t.lastActiveAt)}</span>
        </div>
      </button>`;
  }).join("");
}

loginTab.onclick = () => {
  isLogin = true;
  submitBtn.textContent = "Continue";
  loginTab.classList.add("active");
  registerTab.classList.remove("active");
  clearError();
};

registerTab.onclick = () => {
  isLogin = false;
  submitBtn.textContent = "Create account";
  registerTab.classList.add("active");
  loginTab.classList.remove("active");
  clearError();
};

authForm.onsubmit = async (e) => {
  e.preventDefault();
  clearError();

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!isValidEmail(email)) {
    showError("Please enter a valid email address.");
    return;
  }

  const passwordIssue = getPasswordIssue(password);
  if (passwordIssue) {
    showError(passwordIssue);
    return;
  }

  submitBtn.textContent = "Loading...";
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/auth/${isLogin ? "login" : "register"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await readApiResponse(res);

    if (!res.ok) {
      showError(data.error || data.message || "Something went wrong.");
      return;
    }

    if (data.token) {
      localStorage.setItem("token", data.token);
      loadThreads();
      show(views.threads);
    } else {
      showError("Account created. Please log in.");
      loginTab.onclick();
    }
  } catch {
    showError("Network error. Check that the server is running on port 5000.");
  } finally {
    submitBtn.textContent = isLogin ? "Continue" : "Create account";
    submitBtn.disabled = false;
  }
};

async function handleGoogleCredential(response) {
  clearError();
  setGoogleStatus("Signing in...");

  try {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await readApiResponse(res);

    if (!res.ok || !data.token) {
      setGoogleStatus(data.error || data.message || "Google sign-in failed.", true);
      return;
    }

    localStorage.setItem("token", data.token);
    setGoogleStatus("");
    loadThreads();
    show(views.threads);
  } catch {
    setGoogleStatus("Google sign-in could not reach the server.", true);
  }
}

async function initGoogleSignIn(attempt = 0) {
  if (!googleSignInWrap) return;

  try {
    if (IS_FILE_PAGE) {
      setGoogleStatus(getGoogleOriginHint(), true);
      if (googleFallbackBtn) googleFallbackBtn.disabled = true;
      return;
    }

    if (!googleClientId) {
      const res = await fetch(`${API_BASE}/api/auth/google/config`);
      const data = await readApiResponse(res);
      googleClientId = data.clientId || "";
    }

    if (!googleClientId) {
      setGoogleStatus("Add GOOGLE_CLIENT_ID in .env to enable Google sign-in.", true);
      if (googleFallbackBtn) googleFallbackBtn.disabled = true;
      return;
    }

    if (!window.google?.accounts?.id) {
      if (attempt < 20) {
        setTimeout(() => initGoogleSignIn(attempt + 1), 250);
      }
      return;
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      ux_mode: "popup",
    });

    googleSignInWrap.innerHTML = "";
    window.google.accounts.id.renderButton(googleSignInWrap, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: Math.min(336, googleSignInWrap.offsetWidth || 336),
    });
    setGoogleStatus(getGoogleOriginHint());
  } catch {
    setGoogleStatus("Google sign-in setup failed. Check that the server is running.", true);
  }
}

logoutBtn.onclick = () => {
  localStorage.removeItem("token");
  show(views.auth);
  loginTab.onclick();
  initGoogleSignIn();
};

if (googleFallbackBtn) {
  googleFallbackBtn.onclick = () => {
    setGoogleStatus("Loading Google sign-in...");
    initGoogleSignIn();
  };
}

async function loadThreads() {
  threadsContainer.innerHTML = [1, 2, 3].map(() => `
    <div class="thread-card">
      <div class="skel" style="width:52px;height:52px;border-radius:18px;flex-shrink:0"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px">
        <div class="skel" style="height:14px;width:52%"></div>
        <div class="skel" style="height:11px;width:72%"></div>
      </div>
      <div class="skel" style="height:10px;width:42px"></div>
    </div>
  `).join("");

  try {
    const res = await fetch(`${API_BASE}/api/threads`, {
      headers: { Authorization: "Bearer " + getToken() },
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      show(views.auth);
      return;
    }

    const data = await readApiResponse(res);
    cachedThreads = Array.isArray(data) ? data : (data.threads || []);
    renderThreads();
  } catch {
    threadsContainer.innerHTML = `
      <div class="threads-empty">
        <p>Could not load chats. Check that the server is running.</p>
      </div>`;
  }
}

addThreadBtn.onclick = () => {
  threadModal.classList.remove("hidden");
  nicknameInput.focus();
};

if (promoNewThreadBtn) {
  promoNewThreadBtn.onclick = () => addThreadBtn.click();
}

function closeModal() {
  threadModal.classList.add("hidden");
  nicknameInput.value = "";
}

if (cancelModalBtn) cancelModalBtn.onclick = closeModal;
if (modalBackdrop) modalBackdrop.onclick = closeModal;

createThreadBtn.onclick = async () => {
  const name = nicknameInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch(`${API_BASE}/api/threads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify({ personNickname: name }),
    });

    if (!res.ok) {
      alert("Could not create chat.");
      return;
    }

    closeModal();
    loadThreads();
  } catch {
    alert("Network error.");
  }
};

function openThread(id, name) {
  selectedThreadId = id;
  selectedTone = null;
  selectedReplyStyles = [];
  base64Image = null;

  replyPersonName.textContent = name;
  toneButtons.forEach((b) => b.classList.remove("active"));
  styleChips.forEach((b) => b.classList.remove("active"));
  if (contextInput) contextInput.value = "";
  if (extraContextInput) extraContextInput.value = "";
  if (toneDescription) toneDescription.textContent = "";
  repliesContainer.innerHTML = "";
  generateBtn.disabled = true;

  uploadPlaceholder?.classList.remove("hidden");
  uploadPreview?.classList.add("hidden");
  if (previewImg) previewImg.src = "";
  if (imageInput) imageInput.value = "";

  show(views.reply);
  loadThreadHistory(id);
}

window.openThread = openThread;

backBtn.onclick = () => {
  show(views.threads);
  loadThreads();
};

uploadBox.onclick = () => {
  if (!base64Image) imageInput.click();
};

imageInput.onchange = async () => {
  const file = imageInput.files[0];
  if (!file) return;

  try {
    const dataUrl = await optimizeUploadImage(file);
    base64Image = dataUrl.split(",")[1];
    previewImg.src = dataUrl;
    uploadPlaceholder.classList.add("hidden");
    uploadPreview.classList.remove("hidden");
    checkReady();
  } catch (error) {
    base64Image = null;
    imageInput.value = "";
    alert(error.message || "Could not read that image. Try a JPG, PNG, or WebP screenshot.");
    checkReady();
  }
};

removeImgBtn.onclick = (e) => {
  e.stopPropagation();
  base64Image = null;
  imageInput.value = "";
  previewImg.src = "";
  uploadPlaceholder.classList.remove("hidden");
  uploadPreview.classList.add("hidden");
  checkReady();
};

toneButtons.forEach((btn) => {
  btn.onclick = () => {
    toneButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedTone = btn.dataset.tone;
    if (toneDescription) toneDescription.textContent = btn.dataset.desc || "";
    checkReady();
  };
});

styleChips.forEach((chip) => {
  chip.onclick = () => {
    const style = chip.dataset.style;
    const group = chip.dataset.styleGroup;

    if (group) {
      styleChips.forEach((other) => {
        if (other !== chip && other.dataset.styleGroup === group) {
          other.classList.remove("active");
          selectedReplyStyles = selectedReplyStyles.filter((value) => value !== other.dataset.style);
        }
      });
    }

    chip.classList.toggle("active");

    if (chip.classList.contains("active")) {
      if (!selectedReplyStyles.includes(style)) selectedReplyStyles.push(style);
    } else {
      selectedReplyStyles = selectedReplyStyles.filter((value) => value !== style);
    }
  };
});

intensitySlider.oninput = () => {
  const v = parseInt(intensitySlider.value, 10);
  const pct = ((v - 1) / 9) * 100;
  intensitySlider.style.background =
    `linear-gradient(to right,#FFD95A 0%,#FFD95A ${pct}%,#EADFCB ${pct}%)`;
  const labels = { 1: "subtle", 5: "balanced", 10: "bold" };
  intensityValue.textContent = `${v} - ${labels[v] || ""}`;
};

contextInput.oninput = () => checkReady();
if (extraContextInput) extraContextInput.oninput = () => checkReady();

function checkReady() {
  const hasInput = base64Image || contextInput.value.trim() || extraContextInput?.value.trim();
  generateBtn.disabled = !(hasInput && selectedTone);
}

generateBtn.onclick = async () => {
  if (generateBtn.disabled) return;

  startLoadingStages(Boolean(base64Image));
  generateBtn.disabled = true;
  repliesContainer.innerHTML = "";

  try {
    const body = {
      threadId: selectedThreadId,
      tone: selectedTone,
      intensity: parseInt(intensitySlider.value, 10),
      replyStyles: [...selectedReplyStyles],
    };

    if (base64Image) body.image = base64Image;
    if (contextInput.value.trim()) body.extractedText = contextInput.value.trim();
    if (extraContextInput?.value.trim()) body.userContext = extraContextInput.value.trim();

    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      show(views.auth);
      return;
    }

    const data = await readApiResponse(res);
    if (!res.ok) {
      alert(data.error || data.message || "Generation failed.");
      return;
    }

    const replies = data.replies || [];
    if (!replies.length) {
      repliesContainer.innerHTML = `<p class="threads-empty">No replies came back. Try again.</p>`;
      return;
    }

    repliesContainer.innerHTML = replies.map((r, i) => `
      <div class="reply-card">
        <div class="reply-num">option ${i + 1}</div>
        <span>${escapeHtml(r)}</span>
        <div class="reply-foot">
          <button class="copy-btn" data-idx="${i}">copy</button>
        </div>
      </div>
    `).join("");

    loadThreadHistory(selectedThreadId);

    document.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.onclick = async () => {
        const txt = replies[parseInt(btn.dataset.idx, 10)];
        await navigator.clipboard.writeText(txt);
        btn.textContent = "copied";
        btn.classList.add("copied");

        if (data.messageId) {
          await fetch(`${API_BASE}/api/messages/${data.messageId}/chosen`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + getToken(),
            },
            body: JSON.stringify({ chosenReply: txt }),
          }).catch(() => {});
          await loadThreadHistory(selectedThreadId);
        }

        clearComposer();

        setTimeout(() => {
          btn.textContent = "copy";
          btn.classList.remove("copied");
        }, 1800);
      };
    });

    repliesContainer.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    alert("Network error during generation.");
  } finally {
    clearLoadingStages();
    setGenerateLabel("Generate replies", false);
    checkReady();
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && !threadModal.classList.contains("hidden")) {
    createThreadBtn.click();
  }
});

if (getToken()) {
  loadThreads();
  show(views.threads);
} else {
  initGoogleSignIn();
}
