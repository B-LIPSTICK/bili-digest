/**
 * 扩展设置页（chrome://extensions 里的「扩展程序选项」）。
 */

const $ = (id) => document.getElementById(id);

const apiKeyInput = $("apiKeyInput");
const toggleKeyBtn = $("toggleKeyBtn");
const testKeyBtn = $("testKeyBtn");
const keyTestResultEl = $("keyTestResult");
const baseUrlInput = $("baseUrlInput");
const modelInput = $("modelInput");
const targetLanguageSelect = $("targetLanguageSelect");
const customLanguageInput = $("customLanguageInput");
const saveSettingsBtn = $("saveSettingsBtn");
const savedHint = $("savedHint");
const themeToggleBtn = $("themeToggleBtn");

async function send(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (!response || response.success === false) {
    throw new Error(response?.error || "请求失败");
  }
  return response;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggleBtn.textContent = isDark ? "☀" : "☾";
}

async function loadTheme() {
  try {
    const { theme } = await chrome.storage.local.get("theme");
    applyTheme(theme === "dark" ? "dark" : "light");
  } catch {
    applyTheme("light");
  }
}

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next }).catch(() => {});
}

function updateCustomVisibility() {
  customLanguageInput.classList.toggle(
    "hidden",
    targetLanguageSelect.value !== "custom",
  );
}

async function loadSettings() {
  try {
    const { settings } = await send("getSettings");
    apiKeyInput.value = settings.aiApiKey || "";
    baseUrlInput.value = settings.aiBaseUrl || "";
    modelInput.value = settings.aiModel || "";
    targetLanguageSelect.value = settings.targetLanguage || "English";
    customLanguageInput.value = settings.customLanguage || "";
    updateCustomVisibility();
  } catch (error) {
    keyTestResultEl.className = "hint error";
    keyTestResultEl.textContent = error.message;
  }
}

async function saveSettings() {
  try {
    await send("setSettings", {
      settings: {
        aiApiKey: apiKeyInput.value.trim(),
        aiBaseUrl: baseUrlInput.value.trim(),
        aiModel: modelInput.value.trim(),
        targetLanguage: targetLanguageSelect.value,
        customLanguage: customLanguageInput.value.trim(),
      },
    });
    savedHint.classList.remove("hidden");
    setTimeout(() => savedHint.classList.add("hidden"), 2000);
  } catch (error) {
    keyTestResultEl.className = "hint error";
    keyTestResultEl.textContent = error.message;
  }
}

async function testApiKey() {
  keyTestResultEl.className = "hint";
  keyTestResultEl.textContent = "正在测试…";
  testKeyBtn.disabled = true;
  try {
    const result = await send("testApiKey", {
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
    });
    keyTestResultEl.className = "hint ok";
    keyTestResultEl.textContent = `连接成功：${result.text}`;
  } catch (error) {
    keyTestResultEl.className = "hint error";
    keyTestResultEl.textContent = error.message;
  } finally {
    testKeyBtn.disabled = false;
  }
}

toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "text" ? "password" : "text";
});
themeToggleBtn.addEventListener("click", toggleTheme);
targetLanguageSelect.addEventListener("change", updateCustomVisibility);
testKeyBtn.addEventListener("click", testApiKey);
saveSettingsBtn.addEventListener("click", saveSettings);

loadTheme();
loadSettings();
