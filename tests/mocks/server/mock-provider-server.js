import http from "node:http";

export async function startMockProviderServer({ host = "127.0.0.1", scenario } = {}) {
  const calls = [];
  let completionIndex = 0;

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";

    if (req.method === "GET" && url === "/models") {
      const models = scenario?.models ?? [{ id: "mock-model-a" }, { id: "mock-model-b" }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: models }));
      return;
    }

    if (req.method === "POST" && url === "/chat/completions") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText || "{}");
      calls.push({ path: url, body });

      const responses = scenario?.chatCompletions ?? [];
      const currentIndex = completionIndex++;
      if (currentIndex >= responses.length) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unexpected request — scenario responses exhausted" }));
        return;
      }
      const current = responses[currentIndex];

      if (current?.delayMs) await new Promise((r) => setTimeout(r, current.delayMs));

      if (current?.type === "error") {
        res.writeHead(current.status || 500, { "content-type": "application/json" });
        res.end(JSON.stringify(current.body || { error: { message: "mock error" } }));
        return;
      }

      const payload = current?.body || {
        id: "chatcmpl-mock",
        model: body.model || "mock-model-a",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ corrected: "ok", changes: [], confidence: 10 }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404).end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
