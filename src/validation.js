// Input validation for the admin forms. Every function returns a cleaned value or throws ValidationError.

export class ValidationError extends Error {}

const clean = (value) => String(value ?? '').replace(/\r\n/g, '\n').replace(/\u0000/g, '');

export function text(value, { label, max = 200, required = true, multiline = false } = {}) {
  let v = clean(value);
  v = multiline ? v.trim() : v.replace(/\s+/g, ' ').trim();
  if (required && !v) throw new ValidationError(`${label}為必填欄位`);
  if (v.length > max) throw new ValidationError(`${label}不可超過 ${max} 個字元`);
  return v;
}

export function int(value, { label, min = 1, max = 9999 } = {}) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new ValidationError(`${label}必須是整數`);
  const n = Number(raw);
  if (n < min || n > max) throw new ValidationError(`${label}必須介於 ${min} 到 ${max}`);
  return n;
}

export function email(value, { label = 'Email', required = true } = {}) {
  const v = text(value, { label, max: 120, required });
  if (v && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v)) throw new ValidationError(`${label}格式不正確`);
  return v;
}

const isHttps = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

export function webUrl(value, { label = '網址', required = true } = {}) {
  const v = text(value, { label, max: 300, required });
  if (v && !isHttps(v)) throw new ValidationError(`${label}必須是 http:// 或 https:// 開頭的網址`);
  return v;
}

const SAFE = '[\\w.() \\-]+';
const PDF_PATH = new RegExp(`^paperfile/${SAFE}/${SAFE}\\.pdf$`, 'i');
const DOWNLOAD_PATH = new RegExp(`^downloads/${SAFE}$`, 'i');
const IMAGE_PATH = new RegExp(`^(?:file|images)/${SAFE}\\.(?:jpe?g|png|webp|gif)$`, 'i');

/** Paper / cover / contents PDF: empty (-> null), a `paperfile/<issue>/<name>.pdf` path, or an http(s) URL. */
export function pdfPath(value, { label = 'PDF 路徑' } = {}) {
  const v = text(value, { label, max: 300, required: false });
  if (!v) return null;
  if (PDF_PATH.test(v) || isHttps(v)) return v;
  throw new ValidationError(`${label}必須是 paperfile/期別/檔名.pdf 或完整網址`);
}

export function downloadPath(value, { label = '檔案路徑' } = {}) {
  const v = text(value, { label, max: 300 });
  if (DOWNLOAD_PATH.test(v) || isHttps(v)) return v;
  throw new ValidationError(`${label}必須是 downloads/檔名 或完整網址`);
}

export function imagePath(value, { label = '圖片路徑' } = {}) {
  const v = text(value, { label, max: 300 });
  if (IMAGE_PATH.test(v) || isHttps(v)) return v;
  throw new ValidationError(`${label}必須是 file/或 images/ 底下的圖片，或完整網址`);
}

export function pubDate(value) {
  const v = text(value, { label: '出版日期', max: 10 });
  if (!/^\d{4}\/\d{1,2}$/.test(v)) throw new ValidationError('出版日期格式必須像 2025/7');
  return v;
}

export function username(value) {
  const v = text(value, { label: '帳號', max: 64 });
  if (!/^[A-Za-z0-9._@+-]{3,64}$/.test(v)) throw new ValidationError('帳號只能使用英數字與 . _ @ + -（可直接用 Email），長度 3–64');
  return v;
}

export function password(value) {
  const v = String(value ?? '');
  if (v.length < 10) throw new ValidationError('密碼至少需要 10 個字元');
  if (v.length > 200) throw new ValidationError('密碼過長');
  return v;
}
