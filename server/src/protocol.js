/**
 * Nools & CTAT Language Server - JSON-RPC 2.0 LSP Protocol Transport
 * Implements standard LSP framing (Content-Length header) over stdio streams.
 */

class LSPTransport {
  constructor(inputStream, outputStream) {
    this.inputStream = inputStream;
    this.outputStream = outputStream;
    this.buffer = Buffer.alloc(0);
    this.contentLength = -1;
    this.messageHandlers = new Map();
    this.notificationHandlers = new Map();

    this.inputStream.on('data', chunk => this.handleData(chunk));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.contentLength === -1) {
        // Look for \r\n\r\n header delimiter
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerStr = this.buffer.slice(0, headerEnd).toString('utf-8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        if (!match) {
          throw new Error(`Malformed LSP header: ${headerStr}`);
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) {
        break; // Wait for full body
      }

      const bodyBuffer = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(bodyBuffer.toString('utf-8'));
        this.dispatch(message);
      } catch (err) {
        console.error('Failed to parse JSON-RPC message:', err);
      }
    }
  }

  dispatch(message) {
    // 1. Request with id
    if (message.id !== undefined && message.method) {
      const handler = this.messageHandlers.get(message.method);
      if (handler) {
        Promise.resolve(handler(message.params)).then(
          result => this.sendResponse(message.id, result),
          error => this.sendError(message.id, -32603, error.message || 'Internal Error')
        );
      } else {
        this.sendError(message.id, -32601, `Method not found: ${message.method}`);
      }
      return;
    }

    // 2. Notification without id
    if (message.method && message.id === undefined) {
      const handler = this.notificationHandlers.get(message.method);
      if (handler) {
        handler(message.params);
      }
    }
  }

  onRequest(method, handler) {
    this.messageHandlers.set(method, handler);
  }

  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
  }

  send(payload) {
    const json = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(json, 'utf-8');
    const header = `Content-Length: ${byteLength}\r\n\r\n`;
    this.outputStream.write(header + json);
  }

  sendResponse(id, result) {
    this.send({
      jsonrpc: '2.0',
      id,
      result: result !== undefined ? result : null
    });
  }

  sendError(id, code, message) {
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message }
    });
  }

  sendNotification(method, params) {
    this.send({
      jsonrpc: '2.0',
      method,
      params
    });
  }
}

module.exports = {
  LSPTransport
};
