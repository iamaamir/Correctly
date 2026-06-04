export class OpenAICompatibleClient {
  constructor({ baseUrl, apiKey = "local", model, temperature = 0.2, timeoutMs = 120000 }) {
    if (!baseUrl) throw new Error("OpenAICompatibleClient requires baseUrl");
    if (!model) throw new Error("OpenAICompatibleClient requires model");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.timeoutMs = timeoutMs;
  }

  async chat({ system, user, temperature = this.temperature }) {
    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    };
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey || "local"}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Local model HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Local model returned empty content");
    return { content, usage: data.usage || null };
  }
}
