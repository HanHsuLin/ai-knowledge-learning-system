import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

let client;

function hasConfiguredApiKey() {
  const apiKey = config.geminiApiKey.trim();
  return Boolean(apiKey) && ![
    "your_gemini_api_key",
    "YOUR_GEMINI_API_KEY"
  ].includes(apiKey);
}

function getClient() {
  if (!hasConfiguredApiKey()) {
    const error = new Error("缺少 GEMINI_API_KEY，尚未啟用 Gemini 服務。");
    error.statusCode = 503;
    throw error;
  }
  client ||= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

function conversationText(messages) {
  return messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => `${message.role === "user" ? "學習者" : "引導者"}：${message.content}`)
    .join("\n");
}

export async function generateTutorReply({ material, messages, learnerText }) {
  const conversation = conversationText(messages);

  const prompt = [
    "以下是學習材料：",
    material,
    "",
    "以下是先前對話：",
    conversation || "（尚無）",
    "",
    `學習者最新回答：${learnerText}`,
    "請只提出一個最值得繼續思考的問題。"
  ].join("\n");

  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: {
      systemInstruction: [
        "你是知識整合學習系統的蘇格拉底式引導者。",
        "使用繁體中文，根據提供的材料追問，不直接替學習者作答。",
        "優先追問證據、條件、因果、反例、新舊理解差異。",
        "不要捏造材料中不存在的內容。"
      ].join("\n"),
      maxOutputTokens: 400
    }
  });

  return response.text?.trim() || "你可以再指出材料中支持這個判斷的證據嗎？";
}

export async function generateViewpointSummary({ material, messages }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "學習材料：",
      material,
      "",
      "學習對話：",
      conversationText(messages),
      "",
      "請將學習者目前的理解整理成一段第一人稱觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你負責整理學習者已經表達的觀點，不替學習者添加新主張。",
        "使用繁體中文與第一人稱，例如「我目前的理解是」。",
        "保留學習者提到的證據、條件、疑問與保留之處。",
        "若對話證據不足，要清楚寫出仍需確認的部分。",
        "只輸出觀點正文，不加標題、清單或說明。"
      ].join("\n"),
      maxOutputTokens: 800
    }
  });

  const text = response.text?.trim();
  if (!text) {
    const error = new Error("Gemini 未回傳可用的觀點內容。");
    error.statusCode = 502;
    throw error;
  }
  return text;
}

export async function generateRevisionQuestion({ material, viewpoint, learnerRequest }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "學習材料：",
      material,
      "",
      "目前的觀點彙整：",
      viewpoint,
      "",
      `學習者希望修改的內容：${learnerRequest}`,
      "請先提出一個釐清問題，不要直接重寫觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你是觀點修改助手，使用繁體中文。",
        "第一輪必須先釐清學習者想修改的意思、證據或適用條件。",
        "這一輪不得輸出修改後的完整觀點。",
        "只提出一個具體而簡短的問題。"
      ].join("\n"),
      maxOutputTokens: 300
    }
  });
  return response.text?.trim() || "你希望修改的是哪一個主張？可以補充理由或材料證據嗎？";
}

export async function generateRevisedViewpoint({ material, viewpoint, revisionMessages }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "學習材料：",
      material,
      "",
      "修改前的觀點：",
      viewpoint,
      "",
      "修改討論：",
      conversationText(revisionMessages),
      "",
      "請根據修改討論產生新版觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你是觀點修改助手，使用繁體中文與第一人稱。",
        "只能依照學習者在修改討論中確認的意圖改寫。",
        "保留未被要求刪除且有材料支持的重要內容。",
        "不得自行補入材料與對話中不存在的新主張。",
        "只輸出修改後的觀點正文。"
      ].join("\n"),
      maxOutputTokens: 800
    }
  });
  const text = response.text?.trim();
  if (!text) {
    const error = new Error("Gemini 未回傳可用的修改內容。");
    error.statusCode = 502;
    throw error;
  }
  return text;
}

export async function generateIntegrationReply({ sourceViewpoint, targetViewpoint, messages, learnerText }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "本次已確認觀點：",
      sourceViewpoint,
      "",
      "另一筆已確認觀點：",
      targetViewpoint,
      "",
      "先前比較對話：",
      conversationText(messages) || "（尚無）",
      "",
      `學習者最新回答：${learnerText}`,
      "請只提出一個最值得繼續比較或整合的問題。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你是跨來源知識整合的蘇格拉底式引導者，使用繁體中文。",
        "引導學習者辨識共同點、差異、證據來源、適用條件與可能的因果或矛盾。",
        "不要替學習者直接完成整合，也不要捏造兩筆觀點未提及的內容。",
        "每次只提出一個具體問題。"
      ].join("\n"),
      maxOutputTokens: 400
    }
  });
  return response.text?.trim() || "這兩筆觀點的差異比較可能來自證據、適用條件，還是理解的改變？";
}

export async function generateIntegrationSummary({ sourceViewpoint, targetViewpoint, messages }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "本次已確認觀點：",
      sourceViewpoint,
      "",
      "另一筆已確認觀點：",
      targetViewpoint,
      "",
      "比較與追問對話：",
      conversationText(messages),
      "",
      "請整理成一段第一人稱的跨來源整合觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你負責忠實整理學習者對兩筆觀點的比較與整合，使用繁體中文。",
        "保留共同點、差異、證據、條件與學習者仍不確定之處。",
        "不要自行判定知識關係類型，關係類型將由學習者另外選擇。",
        "不得加入觀點與對話中不存在的新主張。",
        "只輸出整合觀點正文。"
      ].join("\n"),
      maxOutputTokens: 900
    }
  });
  const text = response.text?.trim();
  if (!text) {
    const error = new Error("Gemini 未回傳可用的整合內容。");
    error.statusCode = 502;
    throw error;
  }
  return text;
}

export async function generateIntegrationRevisionQuestion({ sourceViewpoint, targetViewpoint, integration, learnerRequest }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "觀點一：", sourceViewpoint,
      "", "觀點二：", targetViewpoint,
      "", "目前的跨來源整合：", integration,
      "", `學習者希望修改的內容：${learnerRequest}`,
      "請先提出一個釐清問題，不要直接重寫整合觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你是跨來源整合觀點的修改助手，使用繁體中文。",
        "先確認學習者想修改的主張、證據、條件或兩筆觀點之間的關係。",
        "這一輪不得輸出修改後的完整內容，只提出一個簡短問題。"
      ].join("\n"),
      maxOutputTokens: 300
    }
  });
  return response.text?.trim() || "你希望修改哪一段比較或關係？可以補充理由嗎？";
}

export async function generateRevisedIntegration({ sourceViewpoint, targetViewpoint, integration, revisionMessages }) {
  const response = await getClient().models.generateContent({
    model: config.geminiModel,
    contents: [
      "觀點一：", sourceViewpoint,
      "", "觀點二：", targetViewpoint,
      "", "修改前的跨來源整合：", integration,
      "", "修改討論：", conversationText(revisionMessages),
      "", "請依照討論產生修改後的跨來源整合觀點。"
    ].join("\n"),
    config: {
      systemInstruction: [
        "你是跨來源整合觀點的修改助手，使用繁體中文與第一人稱。",
        "只能依照學習者在修改討論中確認的方向改寫。",
        "保留未被要求刪除的重要比較，不得加入不存在的新主張。",
        "只輸出修改後的正文。"
      ].join("\n"),
      maxOutputTokens: 900
    }
  });
  const text = response.text?.trim();
  if (!text) {
    const error = new Error("Gemini 未回傳可用的修改內容。");
    error.statusCode = 502;
    throw error;
  }
  return text;
}

export function geminiStatus() {
  return {
    configured: hasConfiguredApiKey(),
    model: config.geminiModel
  };
}
