/** 게시판 본문 정제 (기존 tests/postSanitizer.test.js 이식 + base64 분리 최적화 확인) */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  extractPostText,
  hasMeaningfulContent,
  preparePostHtml,
  sanitizePostHtml,
  sanitizePostHtmlWithoutShortcut
} from '../../src/lib/postSanitizer.ts';

/** 에디터(텍틱 표 포함)가 실제로 보내는 HTML — 브라우저에서 캡처 */
const tacticHtml = readFileSync(new URL('../fixtures/tactic-post.html', import.meta.url), 'utf8');
// 무작위 바이트라 같은 조각이 되풀이되지 않는다 (끼어든 횟수를 셀 수 있게).
const bigBase64 = randomBytes(30_000).toString('base64');

function countMatches(html, pattern) {
  return (html.match(pattern) || []).length;
}

test('텍틱 표 마크업은 정제 후에도 구조와 값이 유지된다', () => {
  const out = sanitizePostHtml(tacticHtml);
  for (const pattern of [/<table\b/g, /<tr\b/g, /<td\b/g, /<select\b/g, /<option\b/g, /<input\b/g, /<img\b/g, /<button\b/g, /data-tactic-slot=/g]) {
    assert.equal(countMatches(out, pattern), countMatches(tacticHtml, pattern), `개수 불일치: ${pattern}`);
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
  assert.doesNotMatch(out, /<img(?![^>]*src=)/, 'src 없는 img는 남기지 않는다');
});

test('화면 위장용 class·style은 제거하고 허용 스타일만 남긴다', () => {
  const out = sanitizePostHtml(
    '<div class="modal-root clan-tactic-table__row" style="position:fixed;inset:0;z-index:9;color:#f00;font-size:20px">x</div>'
  );
  assert.doesNotMatch(out, /modal-root|position|inset|z-index/);
  assert.match(out, /class="clan-tactic-table__row"/);
  assert.match(out, /color:#f00/);
  assert.match(out, /font-size:20px/);
});

test('data: 이미지·동영상은 허용 MIME만 남는다', () => {
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

test('큰 base64를 빼고 정제해도 sanitize-html만 쓴 결과와 같다', () => {
  const samples = [
    `<p>앞</p><img src="data:image/png;base64,${bigBase64}"><p>뒤</p>`,
    `<video src='data:video/mp4;base64,${bigBase64}' controls></video>${tacticHtml}`,
    // 허용하지 않는 MIME은 그대로 지워져야 한다.
    `<img src="data:image/svg+xml;base64,${bigBase64}"><video src="data:text/html;base64,${bigBase64}"></video>`,
    // a의 href에 든 data:는 src가 아니므로 분리하지 않고 정제기가 지운다.
    `<a href="data:text/html;base64,${bigBase64}">x</a>`,
    // 본문 글자 안의 src="data:..."도 그대로 글자로 남는다.
    `<p> src="data:image/png;base64,${bigBase64}"</p>`
  ];
  for (const html of samples) {
    const expected = sanitizePostHtmlWithoutShortcut(html);
    assert.equal(sanitizePostHtml(html), expected);
    const prepared = preparePostHtml(html);
    assert.equal(prepared.content, expected);
    assert.equal(prepared.contentText, extractPostText(expected));
  }
});

test('자리표시자 모양의 글자를 미리 넣어도 다른 base64가 끼어들지 않는다', () => {
  const html = `<p>b64${'0'.repeat(32)}x0x</p><img src="data:image/png;base64,${bigBase64}">`;
  const out = sanitizePostHtml(html);
  assert.equal(out, sanitizePostHtmlWithoutShortcut(html));
  // 원래 base64는 img의 src 한 곳에만 들어가야 한다 (base64의 + 는 정규식 기호라 문자열로 센다).
  assert.equal(out.split(bigBase64).length - 1, 1);
});
