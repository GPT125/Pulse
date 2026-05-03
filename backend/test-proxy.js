const assert = require('assert');
const {
  isPrivateAddress,
  validateTargetUrl,
  rewriteUrl,
  rewriteHtml,
  rewriteCss,
  normalizeSessionId
} = require('./proxy');

const proxyBase = 'https://pulse.test/api/v1/proxy/fetch';
const baseUrl = new URL('https://example.com/docs/page.html');

assert.equal(isPrivateAddress('127.0.0.1'), true);
assert.equal(isPrivateAddress('10.0.0.9'), true);
assert.equal(isPrivateAddress('172.20.1.5'), true);
assert.equal(isPrivateAddress('192.168.1.10'), true);
assert.equal(isPrivateAddress('::1'), true);
assert.equal(isPrivateAddress('8.8.8.8'), false);

assert.throws(() => validateTargetUrl('file:///etc/passwd'), /Only http and https/);
assert.throws(() => validateTargetUrl('http://localhost:4000'), /private\/loopback/);
assert.equal(validateTargetUrl('https://example.com/path').hostname, 'example.com');
assert.equal(normalizeSessionId('abc123_XYZ-9'), 'abc123_XYZ-9');
assert.equal(normalizeSessionId('../bad'), null);

assert.equal(
  rewriteUrl('/assets/app.css', baseUrl, proxyBase),
  `${proxyBase}?url=${encodeURIComponent('https://example.com/assets/app.css')}`
);
assert.equal(rewriteUrl('mailto:hello@example.com', baseUrl, proxyBase), 'mailto:hello@example.com');
assert.equal(rewriteUrl('#section', baseUrl, proxyBase), '#section');
assert.equal(
  rewriteUrl('/dashboard', baseUrl, `${proxyBase}?sid=abc123_XYZ-9`),
  `${proxyBase}?sid=abc123_XYZ-9&url=${encodeURIComponent('https://example.com/dashboard')}`
);

const html = rewriteHtml(`
  <html><head><title>x</title></head><body>
    <a href="/next">Next</a>
    <img src="img.png" srcset="small.png 1x, /large.png 2x">
    <form action="/search" method="post"></form>
    <meta http-equiv="refresh" content="0; url=/login">
  </body></html>
`, baseUrl, proxyBase);

assert.match(html, /<base href="https:\/\/example\.com\/docs\/page\.html">/);
assert.match(html, new RegExp(`${proxyBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?url=`));
assert.match(html, /small\.png/);
assert.match(html, /url=https%3A%2F%2Fexample\.com%2Flogin/);
assert.match(html, /window\.fetch/);
assert.match(html, /XMLHttpRequest/);
assert.match(rewriteHtml('<a href="/x">x</a>', baseUrl, `${proxyBase}?sid=abc123_XYZ-9`), /var S=P\.indexOf\('\?'\)===-1\?'\?':'&';/);

const css = rewriteCss(`
  @import "/css/theme.css";
  .hero { background: url("../img/hero.jpg"); }
`, baseUrl, proxyBase);

assert.match(css, /theme\.css/);
assert.match(css, /hero\.jpg/);
assert.match(css, /api\/v1\/proxy\/fetch\?url=/);

console.log('proxy tests passed');
