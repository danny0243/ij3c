// Editable site texts. Each key lives in the `settings` table; the admin "網站設定" page is generated from this list.
// `kind` selects the validator: text | textarea | email | url | image.

export const SETTING_GROUPS = [
  { id: 'general', title: '網站基本資料' },
  { id: 'hero', title: '首頁封面區塊' },
  { id: 'welcome', title: '歡迎區塊' },
  { id: 'headings', title: '各區塊標題' },
  { id: 'authors', title: '投稿須知' },
  { id: 'contact', title: '聯絡資訊' },
  { id: 'footer', title: '頁尾' },
];

export const SETTING_FIELDS = [
  { key: 'site_title', group: 'general', kind: 'text', max: 200, label: '期刊全名', help: '用於首頁標題、瀏覽器分頁標題與頁尾' },
  { key: 'site_short', group: 'general', kind: 'text', max: 40, label: '期刊簡稱', help: '用於選單左上角、頁尾與各期頁面標題（例如 Vol.13, No.1 | IJ3C）' },
  { key: 'meta_description', group: 'general', kind: 'text', max: 300, label: '網頁描述（meta description）' },

  { key: 'hero_eyebrow', group: 'hero', kind: 'text', max: 120, label: 'ISSN 標示列' },
  { key: 'hero_lead', group: 'hero', kind: 'textarea', max: 800, rows: 3, label: '簡介文字' },
  { key: 'hero_btn_primary', group: 'hero', kind: 'text', max: 40, label: '主要按鈕文字', help: '連結到「已出版期別」區塊' },
  { key: 'hero_btn_secondary', group: 'hero', kind: 'text', max: 40, label: '次要按鈕文字', help: '連結到「投稿須知」區塊' },
  { key: 'cover_image', group: 'hero', kind: 'image', label: '期刊封面圖片路徑', help: '例如 file/ij3cv1.jpg（圖片檔需放在網站的 file/ 或 images/ 資料夾）' },
  { key: 'cover_alt', group: 'hero', kind: 'text', max: 120, label: '封面圖片替代文字' },

  { key: 'welcome_heading', group: 'welcome', kind: 'text', max: 120, label: '標題' },
  { key: 'welcome_body', group: 'welcome', kind: 'textarea', max: 4000, rows: 8, label: '內文', help: '段落之間空一行' },
  { key: 'policy_title', group: 'welcome', kind: 'text', max: 80, label: '審查政策標題' },
  { key: 'policy_items', group: 'welcome', kind: 'textarea', max: 800, rows: 4, label: '審查政策項目', help: '每行一項' },

  { key: 'aims_eyebrow', group: 'headings', kind: 'text', max: 80, label: '宗旨與範圍：小標' },
  { key: 'aims_heading', group: 'headings', kind: 'text', max: 120, label: '宗旨與範圍：標題' },
  { key: 'volumes_eyebrow', group: 'headings', kind: 'text', max: 80, label: '已出版期別：小標' },
  { key: 'volumes_heading', group: 'headings', kind: 'text', max: 120, label: '已出版期別：標題' },
  { key: 'editorial_eyebrow', group: 'headings', kind: 'text', max: 80, label: '編輯委員會：小標' },
  { key: 'editorial_heading', group: 'headings', kind: 'text', max: 120, label: '編輯委員會：標題' },

  { key: 'authors_eyebrow', group: 'authors', kind: 'text', max: 80, label: '小標' },
  { key: 'authors_heading', group: 'authors', kind: 'text', max: 120, label: '標題' },
  { key: 'authors_body', group: 'authors', kind: 'textarea', max: 4000, rows: 8, label: '投稿說明', help: '段落之間空一行' },
  { key: 'downloads_heading', group: 'authors', kind: 'text', max: 80, label: '下載區標題', help: '下載檔案清單請到「下載檔案」維護' },
  { key: 'support_text', group: 'authors', kind: 'text', max: 300, label: '投稿諮詢說明', mustInclude: '{email}', help: '{email} 會自動換成下方的信箱連結' },
  { key: 'support_email', group: 'authors', kind: 'email', label: '投稿諮詢信箱' },

  { key: 'contact_eyebrow', group: 'contact', kind: 'text', max: 80, label: '小標' },
  { key: 'contact_heading', group: 'contact', kind: 'text', max: 120, label: '標題' },
  { key: 'contact_org', group: 'contact', kind: 'text', max: 160, label: '單位名稱' },
  { key: 'contact_address', group: 'contact', kind: 'text', max: 300, label: '地址' },
  { key: 'contact_person', group: 'contact', kind: 'text', max: 200, label: '聯絡人' },
  { key: 'contact_email', group: 'contact', kind: 'email', label: '聯絡信箱' },
  { key: 'contact_fax', group: 'contact', kind: 'text', max: 60, label: '傳真' },
  { key: 'contact_homepage', group: 'contact', kind: 'url', label: '網站網址' },

  { key: 'footer_email', group: 'footer', kind: 'email', label: '頁尾信箱' },
  { key: 'copyright_text', group: 'footer', kind: 'text', max: 200, label: '版權文字' },
];

/** Turns `[{key, value}]` rows into a plain object; unknown or missing keys read as ''. */
export function settingsFromRows(rows) {
  const out = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, '']));
  for (const row of rows) out[row.key] = row.value;
  return out;
}
