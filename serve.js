const http = require("http"), fs = require("fs"), path = require("path");
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8" };
http.createServer((req, res) => {
  const f = path.join(__dirname, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, {"Content-Type": types[path.extname(f)] || "text/plain"}); res.end(d); });
}).listen(5173);
