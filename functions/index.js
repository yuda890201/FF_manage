const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const VALID_CATEGORIES = ["ホッターズ", "中華まん", "常温総菜"];
const MODEL = "claude-sonnet-5";

const EXTRACT_INSTRUCTION =
  "この商品パッケージ・POP・ラベルの写真から商品情報を読み取り、register_item ツールを呼び出してください。" +
  "読み取れない項目は0にしてください。推測で埋めず、写真に写っている情報だけを使ってください。";

// 出力のブレを抑えるため、自由記述のJSONではなくTool Use(関数呼び出し)で
// 型・必須項目を強制する。カテゴリも列挙値(enum)で3種類に固定している。
const REGISTER_ITEM_TOOL = {
  name: "register_item",
  description: "商品パッケージの写真から読み取った商品情報を登録する",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "商品名（日本語。パッケージに記載されている名称そのまま）"
      },
      category: {
        type: "string",
        enum: VALID_CATEGORIES,
        description: "商品分類。ホッターズ=から揚げ・フランクフルト等の温かいホットスナック、中華まん=肉まん等の蒸し中華まん、常温総菜=惣菜パック等の常温商品"
      },
      price: {
        type: "number",
        description: "税込価格。パッケージから読み取れなければ0"
      },
      limitHour: {
        type: "number",
        description: "陳列後の販売期限時間。パッケージに記載がなければ0"
      }
    },
    required: ["name", "category", "price", "limitHour"]
  }
};

exports.analyzeNewItemPhoto = onCall(
  { secrets: [anthropicApiKey], region: "asia-northeast1", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const { imageBase64, mimeType } = request.data || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      throw new HttpsError("invalid-argument", "画像データが必要です。");
    }
    const media_type = typeof mimeType === "string" && mimeType.startsWith("image/") ? mimeType : "image/jpeg";

    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicApiKey.value(),
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          // temperature 0 + Tool Use(下記tools/tool_choice)で、同じ写真に対する
          // 出力(商品名・分類・価格・期限)のブレを最小限に抑える
          temperature: 0,
          tools: [REGISTER_ITEM_TOOL],
          tool_choice: { type: "tool", name: "register_item" },
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type, data: imageBase64 } },
                { type: "text", text: EXTRACT_INSTRUCTION }
              ]
            }
          ]
        })
      });
    } catch (err) {
      logger.error("Anthropic APIへの通信に失敗しました", err);
      throw new HttpsError("unavailable", "AIサービスへの通信に失敗しました。");
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.error("Anthropic APIがエラーを返しました", { status: response.status, errText });
      throw new HttpsError("internal", "AI解析に失敗しました。しばらくしてから再度お試しください。");
    }

    const data = await response.json();
    const toolUseBlock = Array.isArray(data && data.content)
      ? data.content.find((block) => block.type === "tool_use" && block.name === "register_item")
      : null;
    const parsed = toolUseBlock && toolUseBlock.input;

    if (!parsed || typeof parsed !== "object") {
      logger.error("AIの応答からtool_useブロックを取得できませんでした", { data });
      throw new HttpsError("internal", "AIの応答を解析できませんでした。");
    }

    return {
      name: String(parsed.name || "").trim().slice(0, 40),
      category: VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "ホッターズ",
      price: Number.isFinite(parsed.price) ? Math.max(0, Math.round(parsed.price)) : 0,
      limitHour: Number.isFinite(parsed.limitHour) ? Math.max(0, parsed.limitHour) : 0
    };
  }
);
