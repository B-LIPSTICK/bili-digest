/**
 * 扩展设置页（chrome://extensions 里的「扩展程序选项」）。
 */

const $ = (id) => document.getElementById(id);

const apiKeyInput = $("apiKeyInput");
const toggleKeyBtn = $("toggleKeyBtn");
const testKeyBtn = $("testKeyBtn");
const keyTestResultEl = $("keyTestResult");
const baseUrlInput = $("baseUrlInput");
const modelSelect = $("modelSelect");
const modelInput = $("modelInput");
const listModelsBtn = $("listModelsBtn");
const modelListHint = $("modelListHint");
const thinkingLevelSelect = $("thinkingLevelSelect");
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

function updateModelCustomVisibility() {
  modelInput.classList.toggle("hidden", modelSelect.value !== "__custom__");
}

function setModelSelectOptions(names, selected) {
  modelSelect.replaceChildren();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    modelSelect.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "自定义…";
  modelSelect.appendChild(custom);
  modelSelect.value = selected || "__custom__";
  updateModelCustomVisibility();
}

function getCurrentModelValue() {
  return modelSelect.value === "__custom__"
    ? modelInput.value.trim()
    : modelSelect.value;
}

async function loadSettings() {
  try {
    const { settings } = await send("getSettings");
    apiKeyInput.value = settings.aiApiKey || "";
    baseUrlInput.value = settings.aiBaseUrl || "";
    const savedModel = String(settings.aiModel || "").trim();
    if (savedModel) {
      setModelSelectOptions([savedModel], savedModel);
    } else {
      setModelSelectOptions([], "__custom__");
    }
    modelInput.value = "";
    thinkingLevelSelect.value = settings.thinkingLevel || "off";
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
        aiModel: getCurrentModelValue(),
        thinkingLevel: thinkingLevelSelect.value,
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
      model: getCurrentModelValue(),
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

async function fetchModelList() {
  const apiKey = apiKeyInput.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  if (!apiKey || !baseUrl) {
    modelListHint.className = "hint error";
    modelListHint.textContent = !apiKey
      ? "请先填写 API Key"
      : "请先填写接口地址";
    modelListHint.classList.remove("hidden");
    return;
  }

  listModelsBtn.disabled = true;
  listModelsBtn.textContent = "拉取中…";
  modelListHint.className = "hint";
  modelListHint.textContent = "正在拉取模型列表…";
  modelListHint.classList.remove("hidden");
  try {
    const result = await send("listModels", { apiKey, baseUrl });
    fillModelList(result.models);
    modelListHint.className = "hint ok";
    modelListHint.textContent = `已填入「${getCurrentModelValue()}」，可在下拉切换或选「自定义…」手动填写，记得保存`;
  } catch (error) {
    modelListHint.className = "hint error";
    modelListHint.textContent = error.message;
  } finally {
    listModelsBtn.disabled = false;
    listModelsBtn.textContent = "拉取模型";
  }
}

function fillModelList(models) {
  if (!Array.isArray(models) || models.length === 0) return;
  const previous = modelSelect.value;
  const manual = modelInput.value.trim();
  let selected;
  if (models.includes(previous)) {
    selected = previous;
  } else if (previous === "__custom__" && manual) {
    selected = "__custom__";
  } else {
    selected = models[0];
  }
  setModelSelectOptions(models, selected);
  if (selected !== "__custom__") modelInput.value = "";
}

toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "text" ? "password" : "text";
});
themeToggleBtn.addEventListener("click", toggleTheme);
targetLanguageSelect.addEventListener("change", updateCustomVisibility);
testKeyBtn.addEventListener("click", testApiKey);
listModelsBtn.addEventListener("click", fetchModelList);
modelSelect.addEventListener("change", () => {
  if (modelSelect.value !== "__custom__") modelInput.value = "";
  updateModelCustomVisibility();
});
for (const input of [apiKeyInput, baseUrlInput]) {
  input.addEventListener("input", () => {
    setModelSelectOptions([], "__custom__");
    modelListHint.classList.add("hidden");
  });
}
saveSettingsBtn.addEventListener("click", saveSettings);

loadTheme();
loadSettings();
