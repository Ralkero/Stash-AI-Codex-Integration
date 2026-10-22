import { WebSocketServer } from "ws";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { object, check } from "./validation.mjs";
// One policy implementation for both transports. No generic proxy or RPC tunnel.
export function attachWebSocket(server, handle, auth) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      auth.checkOrigin(req);
      check(req.url === "/ws" && wss.clients.size < 12, "CONNECTION_DENIED");
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  wss.on("connection", (ws, upgrade) => {
    const streams = new Set();
    let inFlight = 0,
      alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30000);
    ws.on("message", async (bytes) => {
      let m;
      let acquired = false;
      try {
        m = JSON.parse(bytes.toString());
        object(m, ["id", "path", "body", "token", "time", "nonce"]);
        check(Number.isSafeInteger(m.id), "INVALID_ID");
        check(
          [
            "/pair",
            "/unpair",
            "/status",
            "/suggestions",
            "/scene-results",
            "/review-decisions",
            "/tag-cleanup",
            "/global-tag-cleanup",
            "/review-decision-request",
            "/review-decision-confirm",
            "/conversations",
            "/new",
            "/history",
            "/send",
            "/cancel",
            "/decision",
            "/events",
            "/proposals",
          ].includes(m.path),
          "OPERATION_DENIED",
        );
        check(inFlight < 6, "RATE_LIMIT");
        inFlight++;
        acquired = true;
        const req = Readable.from([JSON.stringify(m.body ?? {})]);
        req.method = "POST";
        req.url = m.path;
        req.headers = {
          host: upgrade.headers.host,
          origin: upgrade.headers.origin,
          "content-type": "application/json",
          authorization: typeof m.token === "string" ? "Bearer " + m.token : "",
          "x-stash-ai-time": m.time,
          "x-stash-ai-nonce": m.nonce,
        };
        const res = new EventEmitter();
        let status = 200,
          stream = false;
        res.headersSent = false;
        res.setHeader = () => {};
        const send = (message) => {
          if (ws.readyState === 1 && ws.bufferedAmount < 1024 * 1024)
            ws.send(JSON.stringify(message));
          else ws.terminate();
        };
        res.writeHead = (s, headers) => {
          status = s;
          res.headersSent = true;
          stream = headers?.["Content-Type"] === "text/event-stream";
          if (stream) {
            streams.add(res);
            send({ id: m.id, status, data: { subscribed: true } });
          }
        };
        res.write = (text) => {
          if (text.startsWith("data: "))
            send({ event: JSON.parse(text.slice(6).trim()) });
        };
        res.end = (text) => {
          if (stream) {
            res.emit("close");
            streams.delete(res);
            return;
          }
          send({ id: m.id, status, data: text ? JSON.parse(text) : {} });
        };
        await handle(req, res);
      } catch {
        if (ws.readyState === 1)
          ws.send(
            JSON.stringify({
              id: m?.id,
              status: 400,
              data: { error: "REQUEST_DENIED" },
            }),
          );
      } finally {
        if (acquired) inFlight--;
      }
    });
    ws.on("close", () => {
      clearInterval(heartbeat);
      for (const res of streams) res.emit("close");
      streams.clear();
    });
    ws.on("error", () => ws.terminate());
  });
  return () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
