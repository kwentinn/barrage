// Serveur statique local. Les chemins du type /pseudo/ renvoient tests/fake-profile.html (faux profil Instagram) :
// sert à essayer l'extension sans toucher à Instagram.  Usage : node serve.js  →  http://localhost:5173/
const http = require("http"), fs = require("fs"), path = require("path");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
http.createServer((req, res) => {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  else if (/^\/[A-Za-z0-9._]+\/?$/.test(url) && !fs.existsSync(path.join(__dirname, url))) url = "/tests/fake-profile.html";
  const f = path.join(__dirname, url);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "text/plain" });
    res.end(d);
  });
}).listen(5173);
