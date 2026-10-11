import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = __dirname;
// Use /tmp for writing files on Vercel serverless environment
const IS_VERCEL = process.env.VERCEL === '1';
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(BASE, 'data');
const DB_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CFG_FILE = IS_VERCEL ? path.join('/tmp', 'config.json') : path.join(BASE, 'config.json');
const UPLOADS_DIR = IS_VERCEL ? path.join('/tmp', 'uploads') : path.join(BASE, 'static', 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

interface AppConfig {
  delay_seconds: number;
  markup_percent: number;
  fixed_add: number;
  round_to: number;
  cost_price_mode: {
    ryans: 'special' | 'regular';
    startech: 'special' | 'regular';
    [key: string]: 'special' | 'regular';
  };
  daraz_app_key?: string;
  daraz_secret?: string;
  daraz_access_token?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  delay_seconds: 3,
  markup_percent: 12,
  fixed_add: 0,
  round_to: 10,
  cost_price_mode: {
    ryans: 'special',
    startech: 'regular'
  },
  daraz_app_key: '',
  daraz_secret: '',
  daraz_access_token: ''
};

function getCfg(): AppConfig {
  try {
    if (fs.existsSync(CFG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (err) {
    console.error('Error reading config.json:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveCfg(cfg: AppConfig): void {
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadDb(): Record<string, any> {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading products.json:', err);
  }
  return {};
}

function saveDb(db: Record<string, any>): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

function loadOrders(): any[] {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading orders.json:', err);
  }
  return [];
}

function saveOrders(orders: any[]): void {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
}

function nowString(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function toNumber(text: any): number | null {
  if (text === null || text === undefined) return null;
  const str = String(text);
  const match = str.match(/\d[\d,]*\.?\d*/);
  if (!match) return null;
  const num = parseFloat(match[0].replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

function clean(text: any): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function siteOf(urlStr: string): 'ryans' | 'startech' {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Link must start with https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Link must start with https://');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'ryans.com' || host.endsWith('.ryans.com')) {
    return 'ryans';
  }
  if (host === 'startech.com.bd' || host.endsWith('.startech.com.bd')) {
    return 'startech';
  }
  throw new Error(`Unsupported site: ${host || urlStr}`);
}

function inStock(val: any): boolean | null {
  if (!val) return null;
  const s = String(val).replace(/\s+/g, '').toLowerCase();
  if (s === 'instock' || s === 'in_stock') return true;
  if (s === 'outofstock' || s === 'out_of_stock') return false;
  return null;
}

function parsePairs($: cheerio.CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};
  $('tr').each((_, el) => {
    const cells = $(el).children('td, th');
    if (cells.length === 2) {
      const k = clean($(cells[0]).text());
      const v = clean($(cells[1]).text());
      if (k && v && k.length < 80 && !specs[k]) {
        specs[k] = v;
      }
    }
  });
  $('dl').each((_, el) => {$(el).find('dt').each((_, dt) => {
      const dd = $(dt).next('dd');
      if (dd.length) {
        const k = clean($(dt).text());
        const v = clean(dd.text());
        if (k && v && k.length < 80 && !specs[k]) {
          specs[k] = v;
        }
      }
    });
  });
  return specs;
}

function findPriceAfter($: cheerio.CheerioAPI, label: string): number | null {
  const labelRegex = new RegExp(`^\\s*${label}\\s*:?\\s*$`, 'i');
  let foundPrice: number | null = null;

  $('*').each((_, el) => {
    if (foundPrice !== null) return false;
    const text = $(el).clone().children().remove().end().text();
    if (labelRegex.test(text)) {
      const parent = $(el).parent();
      const parentText = parent.text();
      const after = parentText.slice(parentText.indexOf(text) + text.length);
      const num = toNumber(after);
      if (num !== null) {
        foundPrice = num;
        return false;
      }
    }
  });

  return foundPrice;
}

function getMeta($: cheerio.CheerioAPI, key: string): string | null {
  const tag = $(`meta[property="${key}"], meta[name="${key}"]`).first();
  const content = tag.attr('content');
  return content ? clean(content) : null;
}

function collectImages($: cheerio.CheerioAPI, site: 'ryans' | 'startech'): string[] {
  const urls: string[] = [];
  const og = getMeta($, 'og:image');

  $('img').each((_, el) => {
    const src = $(el).attr('data-src') \vert{}\vert{}$(el).attr('src') || '';
    if (site === 'ryans' && src.includes('/storage/products/main/')) {
      urls.push(src);
    }
    if (site === 'startech' && src.includes('/image/cache/catalog/')) {
      urls.push(src.replace(/-\d+x\d+(\.\w+)$/, '-500x500$1'));
    }
  });

  if (urls.length === 0 && og) {
    urls.push(og);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!seen.has(u) && !u.includes('logo')) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function parseRyans($: cheerio.CheerioAPI, url: string): any {
  const special = toNumber(getMeta($, 'product:price:amount'));
  const regular = findPriceAfter($, 'Regular Price');
  const brand = getMeta($, 'product:brand') || 'No Brand';
  const rawTitle = clean($('h1').first().text() \vert{}\vert{}$('title').first().text()) || 'Unknown Product';
  const title = rawTitle.toLowerCase().includes(brand.toLowerCase()) ? rawTitle : `${brand} ${rawTitle}`;
  const specs = parsePairs($);
  const boxContent = specs["What's in the box"] || specs['Box Content'] || 'Product, User Manual';

  return {
    source: 'ryans',
    url,
    supplier_sku: getMeta($, 'product:retailer_item_id') || '',
    name: title,
    brand,
    category_hint: getMeta($, 'product:category'),
    price_special: special,
    price_regular: regular ?? special,
    in_stock: inStock(getMeta($, 'product:availability')),
    specs,
    images: collectImages($, 'ryans'),
    box_content: boxContent
  };
}

function parseStartech($: cheerio.CheerioAPI, url: string): any {
  const listed = toNumber(getMeta($, 'product:price:amount'));
  const regular = findPriceAfter($, 'Regular Price');
  const brand = getMeta($, 'product:brand') || 'No Brand';
  const h1 = clean($('h1').first().text());
  const rawTitle = h1 || 'Unknown Product';
  const title = rawTitle.toLowerCase().includes(brand.toLowerCase()) ? rawTitle : `${brand} ${rawTitle}`;
  const specs = parsePairs($);
  const boxContent = specs["What's in the box"] || specs['Box Content'] || 'Product, User Manual';

  return {
    source: 'startech',
    url,
    supplier_sku: getMeta($, 'product:retailer_item_id') || '',
    name: title,
    brand,
    category_hint: null,
    price_special: listed,
    price_regular: regular ?? listed,
    in_stock: inStock(getMeta($, 'product:availability')),
    specs,
    images: collectImages($, 'startech'),
    box_content: boxContent
  };
}

function sellPrice(cost: number | null, cfg: AppConfig): number | null {
  if (cost === null || cost === undefined) return null;
  const raw = cost * (1 + cfg.markup_percent / 100.0) + cfg.fixed_add;
  const step = cfg.round_to;
  return step ? Math.ceil(raw / step) * step : Math.round(raw);
}

function applyPricing(p: any, cfg: AppConfig): any {
  const mode = cfg.cost_price_mode[p.source] || 'regular';
  const cost = mode === 'regular' ? p.price_regular : p.price_special;
  p.cost_price = cost;
  p.cost_mode = mode;
  p.sell_price = sellPrice(cost, cfg);
  return p;
}

function getFlags(p: any): string[] {
  const out: string[] = [];
  if (!p.name) out.push('missing name');
  if (p.cost_price === null || p.cost_price === undefined) out.push('missing price');
  if (!p.images || p.images.length === 0) out.push('no images');
  if (!p.specs || Object.keys(p.specs).length === 0) out.push('no specs parsed (selectors need tuning)');
  if (p.in_stock === false) out.push('out of stock');
  if (p.in_stock === null || p.in_stock === undefined) out.push('stock unknown');
  return out;
}

function finalizeProduct(p: any, cfg: AppConfig): any {
  applyPricing(p, cfg);
  if (p.sell_override !== undefined && p.sell_override !== null) {
    p.sell_price = p.sell_override;
  }
  p.flags = getFlags(p);
  p.status = p.status || 'draft';
  p.description = p.description || '';
  p.highlights = p.highlights || [];
  p.weight = p.weight || '0.5';
  p.dimensions = p.dimensions || '10x10x10';
  p.warranty = p.warranty || 'No Warranty';
  return p;
}

async function scrapeSupplierProduct(url: string, cfg: AppConfig): Promise<any> {
  const site = siteOf(url);
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/'
  };

  const response = await axios.get(url, { headers, timeout: 30000 });
  const html = response.data;
  const $ = cheerio.load(html);

  let product: any;
  if (site === 'ryans') {
    product = parseRyans($, url);
  } else if (site === 'startech') {
    product = parseStartech($, url);
  } else {
    throw new Error(`Unsupported site: ${site}`);
  }

  return finalizeProduct(product, cfg);
}

function validateProduct(p: any): { is_valid: boolean; issues: Array<{ type: 'error' | 'warn'; msg: string }> } {
  const issues: Array<{ type: 'error' | 'warn'; msg: string }> = [];

  const name = p.name || '';
  if (!name || name.length < 20) {
    issues.push({ type: 'error', msg: 'Title is too short (min 20 chars)' });
  }
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    issues.push({ type: 'warn', msg: 'Title is ALL CAPS (avoid this for Daraz)' });
  }

  const images = Array.isArray(p.images) ? p.images : [];
  if (images.length === 0) {
    issues.push({ type: 'error', msg: 'No images found' });
  } else if (images.length < 3) {
    issues.push({ type: 'warn', msg: `Only ${images.length} images (3+ recommended)` });
  }

  const webpCount = images.filter((img: string) => img.toLowerCase().endsWith('.webp')).length;
  if (webpCount > 0) {
    issues.push({ type: 'warn', msg: `${webpCount} image(s) are in .webp format (Daraz prefers JPG/PNG)` });
  }

  const brand = p.brand;
  if (!brand || brand === 'Unknown Product' || brand === 'No Brand') {
    issues.push({ type: 'warn', msg: 'Brand is missing or unknown' });
  }

  const specs = p.specs || {};
  if (Object.keys(specs).length === 0) {
    issues.push({ type: 'error', msg: 'No technical specifications parsed' });
  }

  const box = p.box_content || '';
  if (!box || (box.includes('Product') && box.length < 15)) {
    issues.push({ type: 'warn', msg: 'Box content description is too vague' });
  }

  return {
    is_valid: !issues.some(i => i.type === 'error'),
    issues
  };
}

class DarazClient {
  private baseUrl = 'https://api.daraz.com.bd/rest';
  constructor(
    private appKey: string,
    private secret: string,
    private accessToken?: string
  ) {}

  private sign(params: Record<string, any>): string {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k !== 'sign') filtered[k] = v;
    }
    const sortedKeys = Object.keys(filtered).sort();
    let signStr = this.secret;
    for (const k of sortedKeys) {
      signStr += `${k}${filtered[k]}`;
    }
    return crypto.createHmac('sha256', this.secret).update(signStr, 'utf8').digest('hex').toUpperCase();
  }

  async request(method: 'GET' | 'POST', apiPath: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.appKey || !this.secret) {
      throw new Error('Missing app_key or secret');
    }
    const payload: Record<string, any> = {
      ...params,
      app_key: this.appKey,
      timestamp: Date.now().toString()
    };
    if (this.accessToken) {
      payload.access_token = this.accessToken;
    }
    payload.sign = this.sign(payload);

    const url = `${this.baseUrl}${apiPath}`;
    try {
      if (method === 'GET') {
        const res = await axios.get(url, { params: payload, timeout: 30000 });
        return res.data;
      } else {
        const res = await axios.post(url, payload, { timeout: 30000 });
        return res.data;
      }
    } catch (err: any) {
      return { error: err.message, code: 'HTTP_ERROR' };
    }
  }

  async getOrders(): Promise<any> {
    return this.request('GET', '/seller/get_order_list');
  }

  async updateStock(productId: string, quantity: number): Promise<any> {
    return this.request('POST', '/product/update', { product_id: productId, quantity });
  }
}

async function searchDaraz(query: string, sort = 'priceAsc'): Promise<Array<{ name: string; price: number }>> {
  const url = 'https://www.daraz.com.bd/catalog/';
  try {
    const res = await axios.get(url, {
      params: { ajax: 'true', q: query, sort },
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    const items = res.data?.mods?.listItems || [];
    const results: Array<{ name: string; price: number }> = [];
    for (const item of items) {
      const name = item.name;
      const priceVal = item.price;
      const price = toNumber(priceVal);
      if (name && price !== null) {
        results.push({ name, price });
      }
    }
    return results;
  } catch (err) {
    console.error('Search Daraz error:', err);
    return [];
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/static', express.static(path.join(BASE, 'static')));
app.use(express.static(path.join(BASE, 'static')));

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(BASE, 'static', 'index.html'));
});

app.get('/api/state', (_req: Request, res: Response) => {
  const db = loadDb();
  const published = Object.values(db).filter((p: any) => p.status === 'published');
  res.json({ config: getCfg(), products: published });
});

app.get('/api/drafts', (_req: Request, res: Response) => {
  const db = loadDb();
  const drafts = Object.values(db).filter((p: any) => p.status !== 'published');
  res.json({ products: drafts });
});

app.get('/api/product', (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'missing url' });
  const db = loadDb();
  const p = db[url];
  if (!p) return res.status(404).json({ error: 'product not found' });
  res.json({ product: p });
});

app.get('/api/validate', (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'missing url' });
  const db = loadDb();
  const p = db[url];
  if (!p) return res.status(404).json({ error: 'product not found in database' });
  res.json(validateProduct(p));
});

app.post('/api/process_image', async (req: Request, res: Response) => {
  const url = req.body?.url;
  if (!url) return res.status(400).json({ error: 'missing url' });

  if (typeof url === 'string' && url.toLowerCase().endsWith('.webp')) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      if (response.status === 200) {
        const hash = crypto.createHash('md5').update(url).digest('hex');
        const filename = `${hash}.jpg`;
        const filepath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filepath, response.data);
        return res.json({ url: `/static/uploads/${filename}`, converted: true });
      }
    } catch (err) {
      console.warn('Image download warning:', err);
    }
  }

  return res.json({ url, converted: false });
});

app.post('/api/update_product', (req: Request, res: Response) => {
  const body = req.body || {};
  const url = body.url;
  if (!url) return res.status(400).json({ error: 'missing url' });

  const db = loadDb();
  const p = db[url];
  if (!p) return res.status(404).json({ error: 'product not found' });

  const fields = ['name', 'brand', 'box_content', 'description', 'highlights', 'images', 'weight', 'dimensions', 'warranty', 'status'];
  for (const field of fields) {
    if (field in body && body[field] !== undefined) {
      p[field] = body[field];
    }
  }

  saveDb(db);
  res.json({ product: p });
});

app.post('/api/publish', (req: Request, res: Response) => {
  const url = req.body?.url;
  if (!url) return res.status(400).json({ error: 'missing url' });

  const db = loadDb();
  const p = db[url];
  if (!p) return res.status(404).json({ error: 'not found' });

  p.status = 'published';
  saveDb(db);
  res.json({ status: 'success' });
});

async function runFetchUrls(urls: string[]) {
  const cfg = getCfg();
  const db = loadDb();
  const results: Array<{ url: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      const p = await scrapeSupplierProduct(u, cfg);
      const old = db[u];
      p.added = old?.added || nowString();
      p.checked = nowString();
      p.sell_override = old?.sell_override ?? null;
      p.change = null;

      if (old) {
        const notes: any[] = [];
        if (old.cost_price !== undefined && p.cost_price !== undefined && old.cost_price !== p.cost_price) {
          notes.push({ type: 'price', from: old.cost_price, to: p.cost_price });
        }
        if (old.in_stock !== undefined && old.in_stock !== p.in_stock) {
          notes.push({ type: 'stock', from: old.in_stock, to: p.in_stock });
        }
        p.change = notes.length > 0 ? notes : null;
      }

      db[u] = finalizeProduct(p, cfg);
      results.push({ url: u, ok: true });
    } catch (err: any) {
      results.push({ url: u, ok: false, error: String(err?.message || err).slice(0, 200) });
    }

    if (i < urls.length - 1 && cfg.delay_seconds > 0) {
      await new Promise(r => setTimeout(r, Math.min(cfg.delay_seconds, 1) * 1000));
    }
  }

  saveDb(db);
  return { results, db };
}

app.post('/api/add', async (req: Request, res: Response) => {
  const rawUrls = req.body?.urls || [];
  const urls = rawUrls.map((u: string) => u.trim()).filter((u: string) => Boolean(u));
  const { results, db } = await runFetchUrls(urls);
  res.json({ results, products: Object.values(db) });
});

app.post('/api/refresh', async (req: Request, res: Response) => {
  const db = loadDb();
  const urls = req.body?.urls || Object.keys(db);
  const { results, db: updatedDb } = await runFetchUrls(urls);
  res.json({ results, products: Object.values(updatedDb) });
});

app.post('/api/config', (req: Request, res: Response) => {
  const body = req.body || {};
  const cfg = getCfg();

  for (const k of ['markup_percent', 'fixed_add', 'round_to', 'delay_seconds'] as const) {
    if (
