import { createServer } from "node:http";

export function handleRequest(request, response) {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
}

export function createApp() {
  return createServer(handleRequest);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`demo service listening on ${port}`);
  });
}
