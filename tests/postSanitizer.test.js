'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sanitizePostHtml, extractPostText, hasMeaningfulContent } = require('../lib/postSanitizer');

/** 에디터(텍틱 표 포함)가 실제로 보내는 HTML — 브라우저에서 캡처 */
const tacticHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'tactic-post.html'), 'utf8');

function countMatches(html, re) {
  return (html.match(re) || []).length;
}

test('텍틱 표 마크업은 정제 후에도 구조와 값이 유지된다', () => {
  const out = sanitizePostHtml(tacticHtml);
  for (const re of [/<table\b/g, /<tr\b/g, /<td\b/g, /<select\b/g, /<option\b/g, /<input\b/g, /<img\b/g, /<button\b/g, /data-tactic-slot=/g]) {
    assert.equal(countMatches(out, re), countMatches(tacticHtml, re), `개수 불일치: ${re}`);
  }
  assert.match(out, /<option value="2" selected(="")?>텍틱 테마 2/);
  assert.match(out, /<option value="X" selected(="")?>Auto OFF/);
  assert.match(out, /class="clan-tactic-table__damage-input"[^>]*value="9876"|value="9876"[^>]*class="clan-tactic-table__damage-input"/);
  assert.match(out, /value="30"/);
  assert.match(out, /background:\s*rgb\(139, 195, 74\)/);
  assert.match(out, /font-size:\s*24px/);
  assert.match(out, /<img[^>]+src="\/characters\//);
  assert.match(out, /contenteditable="false"/);
});

test('정제는 멱등이다(두 번 정제해도 같다)', () => {
  const once = sanitizePostHtml(tacticHtml);
  assert.equal(sanitizePostHtml(once), once);
});

test('스크립트·이벤트 핸들러·위험 URL·외부 리소스를 제거한다', () => {
  const out = sanitizePostHtml(
    '<p onclick="x()">a</p><script>alert(1)</script><img src=x onerror=alert(1)>' +
      '<a href="javascript:alert(1)">j</a><a href="https://example.com">ok</a>' +
      '<img src="https://evil.example/t.png"><img src="//evil.example/t.png">' +
      '<iframe src="https://evil.example"></iframe><object data="x"></object>' +
      '<svg><script>alert(1)</script><path d="M0 0" onload="x()"/></svg>' +
      '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">' +
      '<video src="data:text/html;base64,AAAA"></video><style>body{}</style>'
  );
  assert.doesNotMatch(out, /script|onclick|onerror|onload|javascript:|evil\.example|iframe|object|<style|svg\+xml|text\/html/i);
  assert.match(out, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  assert.doesNotMatch(out, /<img(?![^>]*src=)/, 'src 없는 img 는 남기지 않는다');
});

test('화면 위장용 class·style 은 제거하고 허용 스타일만 남긴다', () => {
  const out = sanitizePostHtml(
    '<div class="modal-root clan-tactic-table__row" style="position:fixed;inset:0;z-index:9;color:#f00;font-size:20px">x</div>'
  );
  assert.doesNotMatch(out, /modal-root|position|inset|z-index/);
  assert.match(out, /class="clan-tactic-table__row"/);
  assert.match(out, /color:#f00/);
  assert.match(out, /font-size:20px/);
});

test('data: 이미지·동영상은 허용 MIME 만 남는다', () => {
  const out = sanitizePostHtml(
    '<img src="data:image/png;base64,iVBORw0KGgo="><video src="data:video/mp4;base64,AAAA" controls></video>'
  );
  assert.match(out, /<img src="data:image\/png;base64,/);
  assert.match(out, /<video src="data:video\/mp4;base64,AAAA" controls/);
});

test('검색용 평문은 태그·base64 없이 블록 경계를 띄운다', () => {
  const text = extractPostText('<p>첫 줄</p><p>둘째<img src="data:image/png;base64,QUJD"></p><div>셋</div>');
  assert.equal(text, '첫 줄 둘째 셋');
});

test('빈 본문 판정', () => {
  assert.equal(hasMeaningfulContent('<p></p>', ''), false);
  assert.equal(hasMeaningfulContent('<img src="data:image/png;base64,AA">', ''), true);
  assert.equal(hasMeaningfulContent('<p>a</p>', 'a'), true);
});
