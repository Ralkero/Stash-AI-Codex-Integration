(function () {
  "use strict";
  if (window.StashAITransport) return;
  class Transport {
    constructor(token) {
      this.token = token;
      this.pending = new Map();
      this.seq = 0;
      this.closed = false;
    }
    async open() {
      if (this.closed) throw Error("Connection closed");
      if (this.ws?.readyState === 1) return;
      // A replacement socket would lose its /events subscription. Reconnect via
      // the page's complete status/history/subscription lifecycle, not a send.
      if (this.ws?.readyState === 3)
        throw Error("Companion disconnected. Retry connection.");
      if (this.connecting) return this.connecting;
      this.connecting = new Promise((resolve, reject) => {
        const ws = new WebSocket("ws://127.0.0.1:9998/ws");
        this.ws = ws;
        const timer = setTimeout(() => {
          ws.close();
          reject(Error("Companion connection timed out."));
        }, 8000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(
            Error(
              "Companion offline. Start it with Start.ps1, then Retry connection.",
            ),
          );
        };
        ws.onclose = () => {
          clearTimeout(timer);
          this.connecting = null;
          for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(Error("Companion disconnected. Retry connection."));
          }
          this.pending.clear();
          if (!this.closed) this.onDisconnect?.();
        };
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.event) {
              this.onEvent?.(m.event);
              return;
            }
            const p = this.pending.get(m.id);
            if (!p) return;
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            m.status >= 400
              ? p.reject(Error(m.data.error || "Request failed"))
              : p.resolve(m.data);
          } catch {
            ws.close();
          }
        };
      });
      return this.connecting;
    }
    async call(path, body = {}) {
      await this.open();
      return new Promise((resolve, reject) => {
        const id = ++this.seq,
          timer = setTimeout(() => {
            this.pending.delete(id);
            reject(Error("Request timed out."));
          }, 40000);
        this.pending.set(id, { resolve, reject, timer });
        this.ws.send(
          JSON.stringify({
            id,
            path,
            body,
            token: this.token,
            time: Date.now(),
            nonce: crypto.randomUUID(),
          }),
        );
      });
    }
    close() {
      this.closed = true;
      this.ws?.close();
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new DOMException("Navigation", "AbortError"));
      }
      this.pending.clear();
    }
  }
  window.StashAITransport = Transport;
})();
