# 프린세스 커넥트! Re:Dive 한국 서버 공략 사이트

미래시(Future Sight) 로드맵, 보유 캐릭터 관리, 클랜전·자유 게시판을 제공하는 사이트입니다.
Cloudflare Workers 무료 플랜(Hono + D1 + static assets)에서 돌아갑니다. 구조와 API는 [PROJECT_INDEX.md](PROJECT_INDEX.md)에 있습니다.

> Windows PowerShell에서 `npm.ps1` 실행이 막혀 있으면 아래 `npm`·`npx`를 `npm.cmd`·`npx.cmd`로 바꿔 입력합니다.

## 로컬 실행

Node.js 24 이상이 필요합니다.

```bash
npm install
cp .dev.vars.example .dev.vars        # 로컬 비밀값 (값은 그대로 써도 됨)
npm run db:migrate:local               # 로컬 D1에 스키마 적용
npm run admin -- create --local        # 관리자 계정 만들기 (아이디 영문 8~20자)
npm run dev                            # http://localhost:8787
```

로컬(`ENVIRONMENT=development`)에서는 reCAPTCHA 없이 보안 문자만으로 회원가입할 수 있습니다.

## 테스트

```bash
npm run lint        # 브라우저·Node 스크립트 문법
npm run typecheck   # TypeScript
npm test            # 단위 테스트 + wrangler dev 통합 테스트 (약 1분)
npm run test:browser  # 브라우저 E2E (Windows는 Edge/Chrome을 자동으로 찾음)
```

## 처음 배포하기

Cloudflare 대시보드 작업과 로그인은 계정 주인이 직접 합니다. 한 번만 하면 됩니다.

1. **로그인**: `npx wrangler login`
2. **D1 데이터베이스 만들기**: `npx wrangler d1 create priconne-db`
   출력된 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 넣습니다.
3. **스키마 적용**: `npm run db:migrate:remote`
4. **비밀값 넣기** (값을 물어봅니다):
   ```bash
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put USER_PII_ENCRYPTION_KEY
   npx wrangler secret put RECAPTCHA_SITE_KEY
   npx wrangler secret put RECAPTCHA_SECRET_KEY
   ```
   - `SESSION_SECRET`, `USER_PII_ENCRYPTION_KEY`는 긴 무작위 값을 씁니다. 만드는 방법:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - ⚠️ `USER_PII_ENCRYPTION_KEY`는 한 번 정하면 바꾸지 않습니다. 바꾸면 기존 회원이 모두 로그인할 수 없습니다. 안전한 곳에 따로 보관하세요(관리자 스크립트에도 필요).
   - reCAPTCHA 키는 선택입니다. 지금은 `wrangler.jsonc`의 `ALLOW_SIGNUP_WITHOUT_RECAPTCHA: "true"`로 보안 문자(+ 시도 제한)만으로 가입을 엽니다. reCAPTCHA를 쓰려면 Google reCAPTCHA 관리 콘솔에서 v2 체크박스 키를 만들고, 허용 도메인에 배포 주소(예: `priconne-kr.<계정>.workers.dev`)를 넣은 뒤 두 키를 등록합니다. 키가 있으면 reCAPTCHA도 함께 확인합니다.
5. **배포**: `npm run deploy`
6. **관리자 만들기**: `npm run admin -- create --remote`
   (`USER_PII_ENCRYPTION_KEY`는 `.secrets.production.json`이 있으면 그 값을 쓰고, 없으면 물어봅니다. 4번에서 넣은 값과 같아야 합니다.)

이후 배포는 `npm run deploy`만 하면 됩니다. 스키마를 바꿨다면 먼저 `npm run db:migrate:remote`를 실행합니다.

## 비밀값·설정 요약

| 이름 | 용도 |
|---|---|
| `SESSION_SECRET` | 세션 쿠키 서명 (없으면 로그인 불가) |
| `USER_PII_ENCRYPTION_KEY` | 아이디·닉네임 암호화 (없으면 회원 기능 불가, 바꾸지 말 것) |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | 회원가입 보호 (선택. 넣으면 둘 다 있어야 함) |
| `ALLOW_SIGNUP_WITHOUT_RECAPTCHA` | `wrangler.jsonc` vars. `true`면 reCAPTCHA 없이 보안 문자만으로 가입 허용 (현재 `true`) |
| `ENVIRONMENT=development` | `.dev.vars` 전용. 배포 환경에는 넣지 않음 |

## 캐릭터 목록 바꾸기

원본 이미지 폴더(`CHARACTERS_IMAGE_DIR`, 기본 `<홈>/Documents/프리코네 캐릭터 데이터베이스`)를 정리한 뒤
`npm run build:characters`로 `public/characters/`와 `public/data/characters.json`을 다시 만들고 배포합니다.
기존 캐릭터 id는 유지되므로 회원의 보유 목록이 끊기지 않습니다.
