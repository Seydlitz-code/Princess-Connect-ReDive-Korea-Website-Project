'use strict';

/**
 * 게시판 본문 HTML 정제(allowlist).
 * 에디터(contentEditable)·텍틱 표가 만드는 마크업만 통과시키고, 스크립트·이벤트 핸들러·외부 리소스·
 * 화면 위장에 쓰일 수 있는 class/style 은 제거한다.
 */

const sanitizeHtml = require('sanitize-html');

/** JSON 본문 한도(2mb) 안에서 이스케이프 여유를 둔 HTML 최대 길이 */
const MAX_POST_HTML_LENGTH = 1_800_000;
const MAX_POST_TEXT_INDEX_LENGTH = 20_000;

const CSS_COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i,
];
const CSS_LENGTH = [/^\d{1,4}(\.\d{1,3})?(px|rem|em|%)$/];

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'div', 'span', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'font',
    'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4',
    'a', 'img', 'video',
    'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th',
    'input', 'select', 'option', 'button',
    'svg', 'path',
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
    path: ['d', 'fill'],
  },
  allowedClasses: {
    '*': ['clan-tactic-table*', 'is-selected'],
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
      'aspect-ratio': [/^\d{1,2}\s*\/\s*\d{1,2}$/],
    },
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['data'], video: ['data'] },
  allowProtocolRelative: false,
  parser: { lowerCaseAttributeNames: false },
  // 허용되지 않은 src 가 지워져 내용이 없어진 미디어 태그는 통째로 버린다.
  exclusiveFilter: (frame) => (frame.tag === 'img' || frame.tag === 'video') && !frame.attribs.src,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
    img: (tagName, attribs) => keepSafeMediaSrc(tagName, attribs, /^data:image\/(png|jpe?g|gif|webp);base64,/i),
    video: (tagName, attribs) => keepSafeMediaSrc(tagName, attribs, /^data:video\/[a-z0-9.+-]+;base64,/i),
    input: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, type: attribs.type === 'hidden' ? 'hidden' : 'text' },
    }),
    button: (tagName, attribs) => ({ tagName, attribs: { ...attribs, type: 'button' } }),
  },
};

/** data: 는 지정한 MIME 만, 그 외에는 사이트 내부 상대 경로(/...)만 허용 */
function keepSafeMediaSrc(tagName, attribs, dataRe) {
  const src = String(attribs.src || '');
  const next = { ...attribs };
  const internal = src.startsWith('/') && !src.startsWith('//');
  if (!dataRe.test(src) && !internal) delete next.src;
  return { tagName, attribs: next };
}

function sanitizePostHtml(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTIONS).trim();
}

/** 검색 인덱스용 평문(태그·base64 제거, 블록 경계는 공백으로) */
function extractPostText(html) {
  const spaced = String(html || '').replace(/<(\/?(?:p|div|br|li|td|th|tr|h[1-4]|blockquote)\b)/gi, ' <$1');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_POST_TEXT_INDEX_LENGTH);
}

/** 정제 후 실제로 보여줄 내용(글자·이미지·영상·표)이 있는지 */
function hasMeaningfulContent(sanitizedHtml, text) {
  return Boolean(text) || /<(img|video|table)\b/i.test(sanitizedHtml);
}

module.exports = {
  MAX_POST_HTML_LENGTH,
  sanitizePostHtml,
  extractPostText,
  hasMeaningfulContent,
};
