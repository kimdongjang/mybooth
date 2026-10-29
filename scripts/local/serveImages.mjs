import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export default async function serve(req, res, next) {
  const match = new URL(req.url, 'http://localhost').pathname.match(/^\/(products|inventory)\/([^/]+)\/([^/]+)\/([a-f0-9-]{36}\.(png|jpg|webp))$/);
  if (!match || !['GET','HEAD'].includes(req.method)) return next();
  try {
    const prefix = match.slice(1,4).join('/');
    const bytes = await readFile(`.local-data/images/${createHash('sha256').update(prefix).digest('hex')}/${match[4]}`);
    res.setHeader('Content-Type', {png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[match[5]]);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) { if (error.code === 'ENOENT') { res.statusCode=404; res.end(); } else next(error); }
}
