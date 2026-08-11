import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.js";

function callHandler(path) {
  const response = {
    statusCode: undefined,
    headers: undefined,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
  handleRequest({ url: path }, response);
  return response;
}

describe("demo service", () => {
  it("returns health status", async () => {
    const response = callHandler("/health");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
  });
});
