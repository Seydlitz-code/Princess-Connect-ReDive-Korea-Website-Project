/**
 * 게시판 본문 HTML 정제(허용 목록) (기존 lib/postSanitizer.js 이식, 규칙은 그대로).
 * 에디터(contentEditable)·텍틱 표가 만드는 마크업만 통과시키고, 스크립트·이벤트 핸들러·외부 리소스·
 * 화면 위장에 쓰일 수 있는 class/style은 제거한다.
 */
import sanitizeHtml from 'sanitize-html';

/** 본문 HTML 최대 길이: 1,800,000자 (요청 본문 상한 2MB 안에서 JSON 이스케이프 여유를 둠) */
export const MAX_POST_HTML_LENGTH = 1_800_000;
/** 검색용 평문 최대 길이: 20,000자 */
const MAX_POST_TEXT_INDEX_LENGTH = 20_000;

const CSS_COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i
];
const CSS_LENGTH = [/^\d{1,4}(\.\d{1,3})?(px|rem|em|%)$/];

/** data:는 지정한 MIME만, 그 외에는 사이트 내부 상대 경로(/...)만 허용 */
function keepSafeMediaSrc(tagName: string, attribs: sanitizeHtml.Attributes, dataPattern: RegExp): sanitizeHtml.Tag {
  const src = String(attribs.src || '');
  const next = { ...attribs };
  const isInternal = src.startsWith('/') && !src.startsWith('//');
  if (!dataPattern.test(src) && !isInternal) delete next.src;
  return { tagName, attribs: next };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'div', 'span', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'font',
    'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4',
    'a', 'img', 'video',
    'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th',
    'input', 'select', 'option', 'button',
    'svg', 'path'
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'title', 'hidden', 'contenteditable', 'role', 'aria-*', 'data-*'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    video: ['src', 'controls', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    col: ['span'],
    font: ['size', 'color'],
    input: ['type', 'value', 'placeholder', 'maxlength', 'inputmode', 'autocomplete', 'spellcheck', 'disabled', 'readonly'],
    select: ['disabled'],
    option: ['value', 'selected'],
    button: ['type', 'disabled'],
    svg: ['width', 'height', 'viewBox', 'focusable'],
    path: ['d', 'fill']
  },
  allowedClasses: {
    '*': ['clan-tactic-table*', 'is-selected']
  },
  allowedStyles: {
    '*': {
      'font-size': CSS_LENGTH,
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-decoration': [/^[a-z -]{1,40}$/],
      'text-decoration-line': [/^[a-z -]{1,40}$/],
      'text-align': [/^(left|right|center|justify)$/],
      color: CSS_COLOR,
      background: CSS_COLOR,
      'background-color': CSS_COLOR,
      'max-width': CSS_LENGTH,
      width: CSS_LENGTH,
      height: CSS_LENGTH,
      display: [/^(inline|inline-block|block|none)$/],
      'justify-content': [/^(center|flex-start|flex-end|space-between)$/],
      'object-fit': [/^(contain|cover)$/],
      'aspect-ratio': [/^\d{1,2}\s*\/\s*\d{1,2}$/]
    }
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['data'], video: ['data'] },
  allowProtocolRelative: false,
  parser: { lowerCaseAttributeNames: false },
  // 허용되지 않은 src가 지워져 내용이 없어진 미디어 태그는 통째로 버린다.
  exclusiveFilter: (frame) => (frame.tag === 'img' || frame.tag === 'video') && !frame.attribs.src,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
    }),
    img: (tagName, attribs) => keepSafeMediaSrc(tagName, attribs, /^data:image\/(png|jpe?g|gif|webp);base64,/i),
    video: (tagName, attribs) => keepSafeMediaSrc(tagName, attribs, /^data:video\/[a-z0-9.+-]+;base64,/i),
    input: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, type: attribs.type === 'hidden' ? 'hidden' : 'text' }
    }),
    button: (tagName, attribs) => ({ tagName, attribs: { ...attribs, type: 'button' } })
  }
};

/**
 * src="data:<MIME>;base64,<내용>"의 <내용> 부분. 따옴표 안이 base64 글자만으로 이뤄진 경우만 잡는다.
 * 1: src= 와 따옴표까지, 2: 따옴표, 3: data:<MIME>;base64, 4: base64 내용
 */
const DATA_SRC_PATTERN = /(\ssrc\s*=\s*(["']))(data:[a-z]+\/[a-z0-9.+-]+;base64,)([A-Za-z0-9+/]+={0,2})\2/gi;
/** 이보다 짧은 base64는 그대로 둔다 (자리표시자로 바꿔도 이득이 없음) */
const PLACEHOLDER_MIN_LENGTH = 256;

/**
 * 본문의 큰 base64 내용을 짧은 자리표시자로 바꾼다.
 * 이미지·동영상이 data URL로 들어간 1.7MB 본문은 sanitize-html이 글자 단위로 읽느라 정제에 약 26ms가 걸려
 * 무료 플랜의 요청당 CPU 10ms를 넘는다. base64 글자는 정제 규칙(MIME 검사는 접두사만 봄)과 HTML 이스케이프에
 * 영향을 주지 않으므로, 빼 두었다가 정제 뒤에 그대로 돌려놓아도 결과가 같다.
 * 자리표시자에는 요청마다 무작위 값을 넣어, 글쓴이가 본문에 같은 문자열을 미리 넣어 둘 수 없게 한다.
 */
function extractBase64Payloads(html: string): { skeleton: string; restore: (text: string) => string } {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const payloads: string[] = [];
  const skeleton = html.replace(DATA_SRC_PATTERN, (whole, prefix: string, quote: string, head: string, body: string) => {
    if (body.length < PLACEHOLDER_MIN_LENGTH) return whole;
    payloads.push(body);
    return `${prefix}${head}b64${nonce}x${payloads.length - 1}x${quote}`;
  });
  if (payloads.length === 0) return { skeleton, restore: (text) => text };
  const placeholderPattern = new RegExp(`b64${nonce}x(\\d+)x`, 'g');
  return {
    skeleton,
    restore: (text) => text.replace(placeholderPattern, (_, index: string) => payloads[Number(index)] ?? '')
  };
}

function sanitizeSkeleton(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}

/**
 * 평문 추출. 자리표시자는 보통 src 속성 안이라 평문에서 사라지지만, 본문 글자로 쓴 src="data:..."라면
 * 평문에 남으므로 돌려놓은 뒤 길이를 자른다(자르는 위치가 최적화 전과 같도록).
 */
function extractTextFrom(html: string, restore: (text: string) => string): string {
  const spaced = html.replace(/<(\/?(?:p|div|br|li|td|th|tr|h[1-4]|blockquote)\b)/gi, ' <$1');
  const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return restore(text).slice(0, MAX_POST_TEXT_INDEX_LENGTH);
}

export function sanitizePostHtml(html: string): string {
  const { skeleton, restore } = extractBase64Payloads(html);
  return restore(sanitizeSkeleton(skeleton));
}

/** 검색 인덱스용 평문(태그·base64 제거, 블록 경계는 공백으로) */
export function extractPostText(html: string): string {
  const { skeleton, restore } = extractBase64Payloads(html);
  return extractTextFrom(skeleton, restore);
}

/** 저장용: 정제한 HTML과 검색용 평문을 한 번의 base64 분리로 함께 만든다. */
export function preparePostHtml(html: string): { content: string; contentText: string } {
  const { skeleton, restore } = extractBase64Payloads(html);
  const cleaned = sanitizeSkeleton(skeleton);
  return { content: restore(cleaned), contentText: extractTextFrom(cleaned, restore) };
}

/** 테스트용: 자리표시자 없이 sanitize-html만 쓴 결과 (최적화 전과 같은지 비교) */
export function sanitizePostHtmlWithoutShortcut(html: string): string {
  return sanitizeSkeleton(html);
}

/** 정제 후 실제로 보여줄 내용(글자·이미지·영상·표)이 있는지 */
export function hasMeaningfulContent(sanitizedHtml: string, text: string): boolean {
  return Boolean(text) || /<(img|video|table)\b/i.test(sanitizedHtml);
}
