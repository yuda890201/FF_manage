const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const VALID_CATEGORIES = ["ホッターズ", "中華まん", "常温総菜"];
const MODEL = "claude-sonnet-5";

const EXTRACT_PROMPT = `あなたはコンビニ商品の商品マスタ登録を手伝うアシスタントです。
添付した商品パッケージ・POP・ラベルの写真から、以下の情報をJSONのみで出力してください。
説明文やコードブロックは付けず、JSONオブジェクト単体だけを出力してください。

{
  "name": "商品名（日本語。パッケージ記載の名称をそのまま）",
  "category": "ホッターズ" か "中華まん" か "常温総菜" のいずれか一つ（ホッターズ=から揚げ・フランクフルト等の温かいホットスナック、中華まん=肉まん等の蒸し中華まん、常温総菜=惣菜パック等の常温商品）,
  "price": 税込価格（数値。読み取れなければ0）,
  "limitHour": 陳列後の販売期限時間（数値。パッケージに記載がなければ0）
}`;

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
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type, data: imageBase64 } },
                { type: "text", text: EXTRACT_PROMPT }
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
    const text = data && data.content && data.content[0] && data.content[0].text;
    if (!text) {
      throw new HttpsError("internal", "AIから有効な応答が得られませんでした。");
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (err2) { /* fallthrough */ }
      }
    }
    if (!parsed || typeof parsed !== "object") {
      logger.error("AIの応答をJSONとして解析できませんでした", { text });
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
