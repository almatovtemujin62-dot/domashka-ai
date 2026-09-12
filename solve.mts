declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Используй кнопку «Решить с ИИ»." }, 405);
  }

  const apiKey = Netlify.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return json({ error: "API-ключ пока не подключён на сервере." }, 500);
  }

  try {
    const body = await req.json();
    const image = typeof body?.image === "string" ? body.image : "";
    const subject = typeof body?.subject === "string" ? body.subject : "Другое";
    const mode = typeof body?.mode === "string" ? body.mode : "steps";
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

    if (!image.startsWith("data:image/")) {
      return json({ error: "Сначала загрузи фотографию задания." }, 400);
    }
    if (image.length > 5_500_000) {
      return json({ error: "Фото слишком большое. Попробуй выбрать другое или сделать скриншот задания." }, 413);
    }

    const modeInstruction =
      mode === "short"
        ? "Дай короткий ответ, но добавь минимум вычислений или объяснения, чтобы ответ можно было проверить."
        : mode === "explain"
          ? "Главное — простыми словами объясни тему и ход мысли. Затем покажи решение задания с изображения."
          : "Реши задание подробно и понятно по шагам, затем отдельно укажи финальный ответ.";

    const userPrompt = [
      `Предмет: ${subject}.`,
      modeInstruction,
      comment ? `Уточнение пользователя: ${comment}` : "",
      "Внимательно прочитай именно изображение. Не подменяй условие типовым примером.",
      "Если на фото несколько заданий и пользователь не указал номер — реши все читаемые задания по порядку.",
      "Если часть текста или формулы неразборчива, прямо скажи, что именно не видно, и не выдумывай символы.",
      "Отвечай по-русски, кроме случаев, когда само языковое задание требует ответа на другом языке.",
      "Используй аккуратные переносы строк. Не пиши служебные комментарии про модель или API."
    ].filter(Boolean).join("\n");

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://domashka-ai.netlify.app",
        "X-Title": "Домашка",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content: "Ты — учебный ИИ-помощник «Домашка». Точно читай задания с фотографий, решай их и объясняй без выдуманных данных. Проверяй арифметику и формулы перед ответом."
          },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: image } }
            ]
          }
        ],
        temperature: 0.15,
        max_tokens: 2200
      })
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message = data?.error?.message || data?.message || "OpenRouter временно не ответил.";
      if (upstream.status === 429) {
        return json({ error: "Бесплатный лимит ИИ на время закончился. Попробуй чуть позже." }, 429);
      }
      return json({ error: `ИИ не смог обработать запрос: ${message}` }, 502);
    }

    const content = data?.choices?.[0]?.message?.content;
    const answer = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part: any) => part?.text || "").join("\n").trim()
        : "";

    if (!answer) {
      return json({ error: "ИИ вернул пустой ответ. Попробуй отправить фото ещё раз." }, 502);
    }

    return json({ answer });
  } catch (error) {
    console.error("solve error", error);
    return json({ error: "Не получилось разобрать фото. Попробуй ещё раз через несколько секунд." }, 500);
  }
};

export const config = {
  path: "/api/solve",
};
