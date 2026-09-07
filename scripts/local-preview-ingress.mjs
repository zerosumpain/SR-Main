/** Trusted ingress joins the private preview network; candidate code has no external network. */
import http from 'node:http';
const hostname = process.env.PREVIEW_UPSTREAM;
if (!hostname || !/^sr-preview-[a-zA-Z0-9-]+$/.test(hostname)) throw Error('Invalid preview upstream');
const server = http.createServer((req, res) => {
  const upstream = http.request({ hostname, port: 5275, path: req.url, method: req.method, headers: req.headers }, (reply) => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Preview is starting.'); }); req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = http.request({ hostname, port: 5275, path: req.url, headers: req.headers });
  upstream.on('upgrade', (reply, remote, remainder) => {
    socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`);
    for (let i = 0; i < reply.rawHeaders.length; i += 2) socket.write(`${reply.rawHeaders[i]}: ${reply.rawHeaders[i + 1]}\r\n`);
    socket.write('\r\n'); if (remainder.length) socket.write(remainder); if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket); remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
  });
  upstream.on('error', () => socket.destroy()); upstream.on('response', () => socket.destroy()); upstream.end();
});
server.listen(5275, '0.0.0.0');
