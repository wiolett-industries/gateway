const pageShell = (title: string, heading: string, message: string, status: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#fff;color:#09090b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:100%;max-width:560px;text-align:center}.status{color:#71717a;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}h1{margin:16px 0 0;font-size:clamp(40px,8vw,64px);line-height:1.05;font-weight:700;letter-spacing:-.04em}p.message{margin:20px auto 0;max-width:440px;color:#71717a;font-size:15px;line-height:1.6}.footer{margin-top:48px;color:#71717a;font-size:12px}.footer a{color:inherit;text-decoration:none}.footer a:hover{text-decoration:underline}@media(prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}.status,p.message,.footer{color:#a1a1aa}.footer a{color:#fafafa}}</style></head><body><main><section><div class="status">${status}</div><h1>${heading}</h1><p class="message">${message}</p></section><div class="footer">Powered by <a href="https://wiolett.net" rel="noopener noreferrer">Wiolett</a></div></main></body></html>`;

export const GATEWAY_NOT_FOUND_HTML = pageShell(
  'Page not found',
  'Page not found',
  'The requested host or page is not available.',
  'Error 404'
);

export const GATEWAY_MAINTENANCE_HTML = pageShell(
  'Maintenance in progress',
  'Maintenance in progress',
  'This service is temporarily unavailable while scheduled work is completed. Please try again later.',
  'Error 503'
);

export function escapeNginxReturnText(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/[\r\n]+/g, ' ')}'`;
}
