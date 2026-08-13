/**
 * 扩展设置页（chrome://extensions 里的「扩展程序选项」）。
 */

import { AI_PROVIDERS } from "./lib/ai.js";

const $ = (id) => document.getElementById(id);

const providerSelect = $("providerSelect");
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

// 每个供应商一组草稿值，切换供应商时互不覆盖
const providerDraft = {};

async function send(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (!response || response.success === false) {
    throw new Error(response?.error || "请求失败");
  }
  return response;
}

function buildProviderOptions() {
  providerSelect.replaceChildren();
  for (const preset of Object.values(AI_PROVIDERS)) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    providerSelect.appendChild(option);
  }
}

function presetFor(id) {
  return AI_PROVIDERS[id] || AI_PROVIDERS.custom;
}

function readCurrentProviderDraft() {
  providerDraft[providerSelect.value] = {
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
  };
}

function fillProviderFields(id) {
  const preset = presetFor(id);
  const saved = providerDraft[id] || {};
  apiKeyInput.value = saved.apiKey || "";
  baseUrlInput.value = saved.baseUrl || preset.baseUrl || "";
  modelInput.value = saved.model || preset.model || "";
  baseUrlInput.placeholder = preset.baseUrl || "https://your-endpoint/v1";
  modelInput.placeholder = preset.model || "模型名称";
  const isCustom = id === "custom";
  baseUrlInput.classList.toggle("required", isCustom);
  modelInput.classList.toggle("required", isCustom);
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
    for (const [id, values] of Object.entries(settings.providers || {})) {
      providerDraft[id] = { ...values };
    }
    providerSelect.value = Object.hasOwn(AI_PROVIDERS, settings.aiProvider)
      ? settings.aiProvider
      : "deepseek";
    fillProviderFields(providerSelect.value);
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
    readCurrentProviderDraft();
    await send("setSettings", {
      settings: {
        aiProvider: providerSelect.value,
        providers: providerDraft,
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
    readCurrentProviderDraft();
    const preset = presetFor(providerSelect.value);
    const result = await send("testApiKey", {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim() || preset.baseUrl || "",
      model: modelInput.value.trim() || preset.model || "",
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

buildProviderOptions();

toggleKeyBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "text" ? "password" : "text";
});
providerSelect.addEventListener("change", () => {
  readCurrentProviderDraft();
  fillProviderFields(providerSelect.value);
});
targetLanguageSelect.addEventListener("change", updateCustomVisibility);
testKeyBtn.addEventListener("click", testApiKey);
saveSettingsBtn.addEventListener("click", saveSettings);

loadSettings();
