# Project Index — Princess Connect! Re:Dive Korea Server Strategy Website

> **패키지명**: `priconne-kr-strategy-site`  
> **진입점**: `src/index.ts` (Cloudflare Worker)  
> **현재 버전**: Ver 0.5.9.4 (+ 아래 「다음 버전(미배포)」 변경)  
> **언어**: TypeScript(서버, strict) + JavaScript(브라우저, 빌드 없음)  
> **런타임**: Cloudflare Workers 무료 플랜 (로컬 개발·테스트는 Node.js 24 이상)  
> **배포 대상**: Cloudflare Workers + D1 + Workers static assets (`npm run deploy`)  
> **생성일**: 2026-05-20 · **최종 갱신**: 2026-10-22

---

## 1. 프로젝트 개요

본 프로젝트는 **Cygames의 모바일 게임 "Princess Connect! Re:Dive" 한국 서버**를 위한 **미래시(Future Sight) 전략 가이드 사이트**입니다. 일본/중국 서버의 과거 배너 이력을 기반으로, 한국 서버에 곧 출시될 신규 캐릭터 배너와 재실시 이벤트, 6성 해방 퀘스트 등을 표 형태로 시각화하여 제공합니다.

### 주요 기능
- **Future Sight 테이블**: 월별 캐릭터/이벤트 로드맵
- **소유 캐릭터 관리**: 가입 유저가 자신이 보유한 캐릭터를 체크하여 관리
- **관리자 기능**: Future Sight 데이터 직접 편집
- **회원 가입/로그인**: 서명 쿠키 + 서버 세션 테이블(`user_sessions`) — 로그아웃 시 토큰 즉시 무효화
- **봇 방지**: 커스텀 SVG(path 글리프) 캡차 + 시도 제한, Google reCAPTCHA v2는 키를 넣으면 추가 (현재 미사용)
- **게시판**: 클랜전(세미오토/플오토, 연도·월·단계·네임드 분류) / 자유 게시판, 텍틱 기록기, 추천·댓글

---

## 2. 기술 스택

| 계층 | 기술 |
|---|---|
| **런타임** | Cloudflare Workers 무료 플랜 (요청당 CPU 10ms, 메모리 128MB, 하루 요청 10만) |
| **HTTP 프레임워크** | Hono 4 (`src/index.ts`), 보안 헤더는 직접 설정(기존 helmet 값과 같음) |
| **데이터베이스** | Cloudflare D1 (SQLite), 스키마는 `migrations/` |
| **정적 파일** | Workers static assets (`public/`, Worker를 거치지 않음, 헤더는 `public/_headers`) |
| **인증/세션** | HMAC-SHA256 서명 쿠키(`sub`+`sid`) + `user_sessions` 테이블 확인 (Web Crypto) |
| **비밀번호 해싱** | PBKDF2-SHA256 5만 회 (Web Crypto). 기존 bcrypt는 Workers에서 쓸 수 없음 |
| **PII 암호화** | AES-256-GCM (유저명/닉네임 암호화 + blind HMAC 인덱싱, 기존과 같은 형식) |
| **캡차** | 커스텀 SVG path 글리프 캡차(상태는 D1 `signup_tokens`) + Google reCAPTCHA v2 |
| **시도 제한** | D1 `rate_limits` 고정 1분 창 (로그인·가입 흐름·게시판 쓰기) |
| **게시물 HTML 정제** | sanitize-html (allowlist, 저장 시 정제, 큰 base64는 빼고 정제해 CPU 절약) |
| **주기 작업** | Cron Trigger 매일 KST 00:05 (미래시 월별 정리, 만료 기록 정리) |
| **이미지 처리** | Sharp (devDependency, 로고·캐릭터 라이브러리 빌드용) |
| **테스트** | `node:test` 단위 테스트 + `wrangler dev` 통합 테스트 + Playwright 브라우저 E2E |
| **프론트엔드** | Vanilla JS (프레임워크 없음, 빌드 스텝 없음), 순수 CSS |
| **폰트** | Google Fonts (Noto Sans KR/JP), Gyeonggi Cheonnyeon 폰트 |

---

## 3. 디렉토리 구조

```
/
├── wrangler.jsonc                # Worker 설정: D1 바인딩, 정적 파일(SPA), Cron, PNG 묶기 규칙
├── package.json                  # 의존성 및 스크립트
├── tsconfig.json                 # TypeScript strict
├── .dev.vars.example             # 로컬 비밀값 예시 (.dev.vars로 복사해 사용, git 제외)
│
├── src/                          # Worker (TypeScript)
│   ├── index.ts                  # 앱 조립: 미들웨어 순서, 라우트, 오류 처리, Cron
│   ├── types.ts                  # 바인딩(Env)·요청 변수 타입
│   ├── assets/default-profile.png # 가입 시 기본 프로필 이미지 (Worker 코드에 묶음)
│   ├── routes/
│   │   ├── account.ts            # /api/config, /api/health, /api/signup/*, /api/users/check, /api/register, /api/login, /api/logout
│   │   ├── me.ts                 # /api/me, /api/me/owned-characters
│   │   ├── characters.ts         # /api/characters, /api/characters/:id/image
│   │   ├── futureSight.ts        # /api/future-sight, /api/admin/future-sight
│   │   └── clanBoard.ts          # /api/clan-board/posts/...
│   └── lib/
│       ├── session.ts · sessionToken.ts # 세션 쿠키 발급·검증 (기존 lib/sessionAuth.js)
│       ├── pii.ts · users.ts     # 아이디·닉네임 암호화, 회원 조회·중복 확인 (기존 lib/userPiiCrypto.js)
│       ├── password.ts           # PBKDF2 해시
│       ├── signupCaptcha.ts · captchaSvg.ts # 보안 문자 (기존 lib/signupCaptcha.js)
│       ├── rateLimit.ts          # D1 시도 제한
│       ├── recaptcha.ts          # Google reCAPTCHA v2 확인
│       ├── postSanitizer.ts      # 게시물 HTML 정제 (기존 lib/postSanitizer.js)
│       ├── futureSight.ts · futureSightStore.ts # 미래시 정규화·저장 (기존 lib/futureSight.js)
│       ├── characters.ts · ownedCharacters.ts   # 캐릭터 정적 라이브러리, 보유 캐릭터 저장
│       ├── security.ts           # 보안 헤더(CSP 등), 같은 출처 검사
│       └── http.ts · encoding.ts · ids.ts · time.ts · accountRules.ts · defaultProfile.ts
│
├── migrations/0001_initial.sql   # D1 스키마
│
├── public/                       # 정적 파일 (Workers static assets)
│   ├── _headers                  # 정적 파일 보안·캐시 헤더
│   ├── index.html                # 단일 HTML 페이지 (SPA 셸)
│   ├── css/main.css              # 모든 스타일
│   ├── js/main.js                # 모든 클라이언트 사이드 JS (IIFE)
│   ├── data/characters.json      # 정적 캐릭터 라이브러리 매니페스트 (Worker도 함께 묶어 읽음)
│   ├── characters/               # 캐릭터 이미지 332장
│   ├── fonts/gyeonggi-cheonnyeon/ # 로컬 폰트
│   └── images/                   # 로고, 배너 배경
│
├── scripts/
│   ├── admin.mjs                 # 관리자 계정 생성·승격 (로컬/원격 D1)
│   ├── build-character-library.cjs # 정적 캐릭터 라이브러리 빌드(기존 id 유지, 변경분만 복사)
│   ├── lib/characterSource.cjs   # 캐릭터 원본 폴더 공통 처리
│   ├── process-logo.cjs          # 로고 이미지 처리
│   └── check-static.mjs          # 빌드 없는 JS 문법 검사 (npm run lint)
│
├── test/
│   ├── unit/*.test.mjs           # 순수 모듈 단위 테스트 (src/lib/*.ts를 Node로 바로 불러옴)
│   ├── app.test.mjs              # wrangler dev + 로컬 D1 통합 테스트
│   ├── helpers.mjs               # 서버 기동·쿠키 클라이언트·보안 문자 준비
│   ├── browser/                  # Playwright 브라우저 E2E (run.mjs가 wrangler dev를 띄움)
│   └── fixtures/tactic-post.html # 에디터가 실제로 보내는 텍틱 표 HTML(브라우저 캡처)
│
└── .idea/                        # JetBrains IDE 설정
```

---

## 4. 아키텍처

### 4.1 서버 아키텍처 (`src/index.ts`)

Cloudflare Worker 하나가 `/api/*`만 처리하고, 나머지 주소는 Workers static assets가 `public/`에서 바로 내보냅니다(Worker 요청 수·CPU에 포함되지 않음). 주소에 맞는 파일이 없으면 `index.html`을 돌려줍니다(`not_found_handling: single-page-application`).

기존 Express 서버의 기동 절차(DB 연결 재시도, 스키마 자동 생성, 환경 변수 관리자 생성, 타이머 예약)는 없습니다. 스키마는 `migrations/`로 한 번 적용하고, 관리자는 `npm run admin`으로 만들며, 주기 작업은 Cron이 맡습니다.

**미들웨어 순서**: 보안 헤더 → 본문 크기 제한(2MB, 413) → 같은 출처 검사(POST·PUT·PATCH·DELETE) → 시도 제한 → 라우트 → JSON 404 → 오류 처리기(JSON)

**시도 제한(D1)**: 로그인 IP당 분당 10회, 가입 흐름(캡차·중복 확인·가입) 분당 30회, 게시판 쓰기 분당 30회. 기존의 `/api` 전체 분당 300회 한도는 요청마다 D1 쓰기가 들어 옮기지 않았습니다.

**Cron (매일 KST 00:05)**: 미래시 월별 정리, 만료된 세션·시도 제한·보안 문자·조회 기록 삭제.

### 4.2 API 엔드포인트

경로와 응답 형식은 기존 Express 서버와 같습니다(`public/js/main.js`를 고치지 않음).

| 메서드 | 라우트 | 목적 |
|---|---|---|
| GET | `/api/config` | 공개 런타임 설정 (reCAPTCHA site key, `signupAvailable`) |
| GET | `/api/signup/captcha` | SVG 캡차 챌린지 생성 |
| POST | `/api/signup/verify-step1` | 캡차 검증 → step pass 토큰 발급 |
| POST | `/api/register` | 전체 가입 (2단계: 캡차 + reCAPTCHA + 유저 데이터) |
| POST | `/api/login` | 로그인 (HMAC 서명 쿠키 세션 발급) |
| POST | `/api/logout` | 세션 행 삭제 + 쿠키 제거 |
| GET | `/api/me` | 현재 유저 프로필 조회 |
| PATCH | `/api/me` | 프로필 수정 (닉네임 + 프로필 이미지) |
| GET | `/api/me/owned-characters` | 유저 소유 캐릭터 목록 조회 |
| PATCH | `/api/me/owned-characters` | 소유 캐릭터 업데이트 (전체 교체) |
| GET | `/api/users/check` | 유저명/닉네임 사용 가능 여부 확인 |
| GET | `/api/characters` | 전체 캐릭터 목록 조회 (정적 라이브러리) |
| GET | `/api/characters/:id/image` | 캐릭터 이미지 (정적 파일을 그대로 전달, 예전 주소 호환) |
| GET | `/api/future-sight` | Future Sight 로드맵 데이터 조회 |
| PUT | `/api/admin/future-sight` | 관리자: Future Sight 데이터 수정 |
| GET | `/api/clan-board/posts` | 게시물 목록 조회 (`?board=clan\|free`, `?sub_board=`, `?year=`, `?month=`, `?stage=`, `?named=`, `?category=`, `?search=`(제목·본문 평문), `?page=`, `?limit=`) |
| GET | `/api/clan-board/posts/:id` | 게시물 상세 조회 (잘못된 id 는 404) |
| POST | `/api/clan-board/posts` | 게시물 작성 (`board`, `sub_board`, `title`, `content`; 클랜전은 `year`·`month`·`stage`·`named` 필수, 네임드 → `category` phaseN) |
| PATCH | `/api/clan-board/posts/:id` | 게시물 수정 (작성자만) |
| DELETE | `/api/clan-board/posts/:id` | 게시물 삭제 (작성자·관리자) |
| PATCH | `/api/clan-board/posts/:id/view` | 조회수 증가 (같은 사용자/IP 6시간 내 중복 미집계) |
| POST | `/api/clan-board/posts/:id/likes` | 추천 토글 (계정당 1회) |
| GET | `/api/clan-board/posts/:id/comments` | 댓글 목록 조회 |
| POST | `/api/clan-board/posts/:id/comments` | 댓글 작성 |
| GET | `/api/health` | 상태 확인 (비밀값·reCAPTCHA 설정 여부) |
| GET | `/*` | 정적 파일, 없으면 `index.html` |

### 4.3 데이터베이스 스키마 (D1, `migrations/0001_initial.sql`)

id는 Worker가 만든 UUID 문자열, 시각은 ISO 8601 UTC 문자열입니다. 스키마는 새 번호의 마이그레이션 파일을 추가해서만 바꿉니다.

- **`users`** — id, username_blind·nickname_blind(UNIQUE), username_cipher·nickname_cipher, password_hash, profile_image(data URL), role ('user'/'admin'), created_at. 평문 아이디·닉네임 컬럼은 없습니다.
- **`user_sessions`** — id (= 쿠키의 `sid`), user_id (FK, CASCADE), created_at, expires_at
- **`user_owned_characters`** — user_id (FK), character_id, created_at; composite PK. 캐릭터 id는 저장 전에 정적 라이브러리로 확인
- **`site_future_sight`** — 싱글톤 행 (id=1), data (JSON 문자열), updated_at
- **`clan_board_posts`** — id, author_id (FK), board, sub_board, category, year·month·stage·named, title, content(정제된 HTML), content_text(검색용 평문), view_count, is_pinned(0/1), created_at, updated_at
- **`clan_board_comments`** — id, post_id (FK), author_id (FK), content, created_at
- **`clan_board_likes`** — user_id (FK), post_id (FK), created_at; composite PK + post_id 인덱스
- **`post_view_marks`** — 조회수 중복 방지 기록 (viewer_key, post_id, viewed_at). 비회원 IP는 HMAC으로만 저장
- **`rate_limits`** — 시도 제한 카운터 (key, window_start, count)
- **`signup_tokens`** — 보안 문자 문제·1단계 통과 토큰 (SHA-256 해시로만 저장)

기존 `characters`(이미지 BYTEA) 테이블은 정적 라이브러리만 쓰기로 해 없앴습니다.

### 4.4 인증 및 보안

**세션**: HMAC-SHA256 서명 토큰(`sub`=사용자, `sid`=`user_sessions.id`, `exp`)을 HttpOnly 쿠키(`priconne_sid`)에 저장. 요청마다 서명과 함께 `user_sessions` 행(만료 전)을 확인하므로 로그아웃 시 토큰이 즉시 무효가 됩니다. 7일 만료, SameSite=Lax, HTTPS에서 Secure. `SESSION_SECRET`이 없으면 로그인이 꺼집니다(개발용 고정 키 없음).

**PII 보호**: 유저명과 닉네임은 AES-256-GCM으로 암호화되어 저장되고, 중복 검사·로그인은 blind index(HMAC)로 합니다. 키는 `USER_PII_ENCRYPTION_KEY` 하나만 씁니다(기존의 `SESSION_SECRET` 파생은 없앰). ⚠️ 이 키를 바꾸면 기존 계정을 찾을 수 없으니 처음 정한 값을 유지합니다.

**비밀번호**: PBKDF2-SHA256 5만 회 (`pbkdf2_sha256$반복$salt$hash`). 반복 횟수를 함께 저장하므로 나중에 횟수를 바꿔도 기존 해시를 검증할 수 있습니다. 없는 아이디도 같은 계산을 해 응답 시간으로 계정 존재가 드러나지 않습니다.

**CSRF**: 상태를 바꾸는 요청은 Origin(없으면 Referer)의 호스트가 사이트와 같아야 합니다.

**게시물 HTML**: 저장 시 `src/lib/postSanitizer.ts`(sanitize-html allowlist)로 정제합니다. 큰 이미지·동영상 base64는 정제 전에 무작위 자리표시자로 빼 두었다가 돌려놓아(결과는 같음), 1.7MB 본문 정제가 약 26ms → 5ms로 줄었습니다. CSP(`script-src 'self'`, `media-src 'self' data:`)가 2차 방어선입니다.

**회원가입 플로우** (2단계 봇 방지):
1. **1단계**: SVG path 글리프 캡차 (무작위 5자리, `<text>` 미사용) → `stepPassToken` 획득. 문제는 답을 한 번 확인하면 지워집니다.
2. **2단계**: Google reCAPTCHA v2 → 전체 가입 제출. reCAPTCHA 키가 없으면 `ALLOW_SIGNUP_WITHOUT_RECAPTCHA=true`(배포, `wrangler.jsonc` vars) 또는 `ENVIRONMENT=development`(로컬)일 때만 캡차만으로 가입을 엽니다. 둘 다 아니면 가입을 막습니다(`signupAvailable=false`). 판단은 `src/lib/signupProtection.ts`.
3. 1단계 토큰은 중복 검사 등 검증을 모두 통과한 뒤에만 소모됩니다.

---

## 5. 데이터 흐름

### 5.1 캐릭터 데이터

`public/data/characters.json` + `public/characters/*`의 정적 라이브러리만 씁니다. Worker는 JSON을 코드에 함께 묶어 목록·id 확인에 쓰고, 이미지는 정적 파일(`/characters/...`, `max-age=86400`)로 나갑니다. 캐릭터를 바꾸려면 `npm run build:characters` 후 다시 배포합니다.

### 5.2 Future Sight 데이터

JSON 문자열로 `site_future_sight` 싱글톤 행에 저장됩니다. `applyFutureSightMonthMaintenance()`가 월 인덱스를 조정하고 지난 달을 지웁니다(조회할 때와 매일 Cron). D1에는 행 잠금이 없어 자동 정리는 읽은 뒤 `updated_at`이 그대로일 때만 저장하고(낙관적 잠금), 관리자 저장과 겹치면 다시 읽습니다.

### 5.3 전체 데이터 흐름

```
브라우저 ──(정적 파일)──> Workers static assets (public/)
   │
   └─(fetch /api/*)──> Worker (Hono) ──> D1
                          └─ 캐릭터 목록: 코드에 묶은 characters.json
```

---

## 6. 프론트엔드 아키텍처

### 6.1 개요

클라이언트 사이드 라우터, 빌드 스텝, 번들러, 프레임워크를 전혀 사용하지 않는 **Vanilla JS SPA**입니다. 모든 네비게이션은 DOM 가시성 토글링으로 처리되며, 모든 상호작용은 순수 DOM API로 구현되어 있습니다.

### 6.2 UI 구성

`public/index.html` — 모든 모달이 hidden `<div>` 요소로 정의된 **단일 HTML 페이지**:

| UI 섹션 | 설명 |
|---|---|
| **네비게이션** | 상단 네비게이션 바, 6개 보드: Main, 자유, Clan Battle (전체보기/세미오토/플오토 드롭다운), Battle Stadium, Deep Quest, Abyss. 마이페이지 접속 시 메인 메뉴 대신 "마이페이지" 텍스트로 교체 |
| **Main Board** | "Future Sight" 테이블 — 행 = 월, 열 = 카테고리 (신규/재실시/6성/고유1/고유2/이벤트) |
| **Free Board** | 자유 게시판: 번호/제목/작성자/날짜/조회/추천 6열 목록 (카테고리 없음), 글쓰기, 페이지네이션, 검색 |
| **Clan Board** | 클랜전 게시판: 번호/카테고리/제목/작성자/날짜/조회/추천 7열 목록, 카테고리 탭(전체/1넴~5넴), 전체보기/세미오토/플오토 서브보드 필터링, 페이지네이션, 검색 |
| **Clan Write Form** | 게시물 작성 페이지: SPA 패널 전환. 현재 게시판명 표시(자유/세미오토/플오토), 게시물 구분 드롭다운(자유 게시판에서는 숨김), 제목 50자 제한(+경고문), 2단 툴바(1행: 이미지/동영상/웹 링크/텍틱 작성하기, 2행: 폰트 크기 8~72 28단계 + 볼드/이탤릭/밑줄/취소선), contentEditable 에디터. 텍틱 표 삽입 기능 포함. 작성 완료 시 이전 게시판으로 복귀 |
| **Clan Post Detail** | 게시물 상세 보기: 게시판명 클릭 시 해당 게시판 이동, 분홍색 제목 밴드(카테고리 뱃지 + 제목 + `[댓글N]`), 메타행(작성자 좌측 / 조회|댓글|날짜(수정됨) 우측), 본문, 추천 버튼(계정당 1회 토글, 미추천=회색·추천=분홍), 댓글 `[N]` 헤딩과 목록·작성, 수정(검정)/삭제(빨강)/글쓰기(분홍) 버튼 |

### 6.3 상태 관리

IIFE 클로저 내의 스코프 변수를 통한 상태 관리 (프레임워크 없음). 주요 상태 변수:
- `charactersCache` — 캐릭터 데이터 캐시
- `selectedCharacterIds` — 선택된 캐릭터 ID 목록
- `futureSightState` — Future Sight 데이터
- `sessionUserRole` — 현재 세션 유저의 역할
- `ownedUpdateSelection` — 소유 캐릭터 업데이트 선택 상태
- `currentBoardContext` — 현재 게시판 컨텍스트 (`'clan'` / `'free'`, 글쓰기·뒤로가기 판단에 사용)
- `clanBoardCurrentSubBoard` — 클랜전 서브보드 상태 (`'clan-all'` / `'clan-semi'` / `'clan-fullauto'`)

### 6.4 CSS

단일 파일. CSS 커스텀 프로퍼티를 사용한 테마 설정. 미디어 쿼리를 통한 완전한 반응형 디자인. 프리프로세서나 CSS 프레임워크를 사용하지 않습니다. 클랜전·자유 게시판 게시물 목록 그리드, 게시물 상세 페이지, 텍틱 표(`.clan-tactic-table`), 추천·댓글 통합 레이아웃 스타일 포함.

---

## 7. 사용 가능한 스크립트

| 명령어 | 동작 |
|---|---|
| `npm run dev` | 로컬 실행 (`wrangler dev`, 로컬 D1, http://localhost:8787) |
| `npm run deploy` | 배포 (`wrangler deploy`) |
| `npm run db:migrate:local` / `db:migrate:remote` | D1 스키마 적용 (로컬 / 배포 환경) |
| `npm run admin -- create --local\|--remote` | 관리자 계정 생성 (`promote <아이디>`로 기존 회원 승격) |
| `npm run typecheck` | TypeScript 검사 |
| `npm run lint` | 빌드 없는 JS 문법 검사 (public/js, scripts, test) |
| `npm test` | 단위 테스트 + 통합 테스트(wrangler dev, 약 1분) |
| `npm run test:unit` | 단위 테스트만 |
| `npm run test:browser` | 브라우저 E2E (wrangler dev + Edge/Chrome/Chromium) |
| `npm run build:characters` | 정적 캐릭터 라이브러리 빌드 (기존 id 유지, 바뀐 이미지만 복사) |
| `npm run build:logo` | Sharp를 통한 로고 이미지 처리 |

캐릭터 원본 폴더는 `CHARACTERS_IMAGE_DIR`, 없으면 `<홈>/Documents/프리코네 캐릭터 데이터베이스`입니다.
Windows PowerShell에서 `npm.ps1` 실행이 막혀 있으면 `npm.cmd`/`npx.cmd`를 씁니다.

---

## 8. 빌드 및 배포

처음 설정·배포 절차는 `README.md`에 있습니다.

### 8.1 비밀값·설정

| 이름 | 종류 | 용도 |
|---|---|---|
| `SESSION_SECRET` | secret | 세션 쿠키 서명 키 (로그인에 필수) |
| `USER_PII_ENCRYPTION_KEY` | secret | 아이디·닉네임 암호화 키 (64자리 16진수 권장). ⚠️ 한 번 정하면 바꾸지 않음 |
| `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` | secret | Google reCAPTCHA (선택, 넣으면 가입 때 함께 확인) |
| `ALLOW_SIGNUP_WITHOUT_RECAPTCHA` | `wrangler.jsonc` vars | `true`면 reCAPTCHA 없이 캡차만으로 가입 허용 (2026-10-22부터 `true`) |
| `ENVIRONMENT` | `.dev.vars`만 | `development`면 reCAPTCHA 없이 가입 가능 (배포 환경에는 넣지 않음) |

배포 환경은 `npx wrangler secret put <이름>`, 로컬은 `.dev.vars`(`.dev.vars.example` 복사)로 넣습니다.

### 8.2 무료 플랜 한도와 사용량

- 요청당 CPU 10ms: 로그인·가입의 PBKDF2(5만 회)가 가장 무겁습니다. 큰 게시물 정제는 base64 분리로 5ms 안팎입니다.
- 하루 요청 10만·D1 하루 읽기 500만 행: 정적 파일은 Worker 요청에 포함되지 않으므로 월 1,000회 방문이면 한도의 1% 안팎입니다.
- D1 값 하나 2MB: 게시물 본문은 1.9MB(UTF-8)까지 저장합니다.

### 8.3 브랜치 운영과 CI

작업은 별도 브랜치에서 하고 CI 통과 후 `master`로 병합합니다. 배포는 CI가 아니라 `npm run deploy`로 직접 합니다.
`.github/workflows/ci.yml`은 `master`가 아닌 브랜치 푸시와 `master` 대상 PR에서 실행됩니다.

| 작업 | 내용 |
|---|---|
| `merge-check` | `origin/master`와 실제 병합을 시도해 충돌 파일이 있으면 실패 |
| `test` | 문법 검사, 타입 검사, 단위·통합 테스트(wrangler dev), `wrangler deploy --dry-run`, 운영 의존성 `npm audit --audit-level=high` |
| `browser` | Chromium으로 `npm run test:browser` (글쓰기·텍틱 표·추천·댓글·보안 검증·관리자 미래시 62개 확인) |

---

## 9. 주요 설계 패턴

1. **정적 파일과 API 분리**: 화면·이미지·폰트는 static assets가, `/api/*`만 Worker가 처리해 무료 플랜 요청 수·CPU를 아낍니다
2. **PII 우선 아키텍처**: 모든 개인 데이터(유저명, 닉네임)는 저장 시 암호화됩니다. 중복 검사는 Blind HMAC 인덱스로 수행
3. **커스텀 캡차**: 자체 생성 SVG 캡차 + Google reCAPTCHA. 상태는 D1에 해시로만 저장
4. **메모리 대신 D1**: isolate가 요청마다 바뀔 수 있어 시도 제한·보안 문자·조회수 중복 방지를 D1에 둡니다
5. **마이그레이션 파일**: 스키마는 `migrations/`의 번호 순 파일로만 바꿉니다
6. **Vanilla JS SPA**: 클라이언트 사이드 라우터 없이 DOM toggling만으로 구현. 저복잡도, 저의존성 설계
7. **한국어/일본어 이중 언어 UI**: 네비게이션 레이블과 안내문이 한국어와 일본어로 표시됨
8. **Canvas 기반 이미지 크롭**: 클라이언트 사이드에서 원형 프로필 이미지 크롭, 줌/회전/이동 기능
9. **Future Sight 자동 유지보수**: 조회할 때와 매일 Cron으로 월 인덱스를 전진
10. **마이페이지 헤더 전환**: 마이페이지 라우트에서 상단 네비게이션을 숨기고 "마이페이지" 타이틀로 대체
11. **리치 텍스트 게시물 에디터**: contentEditable 기반. 이미지/동영상 파일 삽입(Data URL), 웹 링크, 텍틱 표, 폰트 크기(8~72), 서식, 제목 50자 제한
12. **멀티 보드 아키텍처**: `board`(`clan`/`free`)와 `sub_board`(`clan-semi`/`clan-fullauto`)로 단일 API에서 필터링
13. **과거→최신 번호 체계**: 게시판 목록 번호를 `total - offset - index`로 산출
14. **통합 추천·댓글 레이아웃**: 추천 버튼과 댓글 헤딩을 단일 `.clan-recommend-bar`에 배치

---

## 10. 외부 의존성 및 API

- **hono** — Workers용 HTTP 라우터
- **sanitize-html** — 게시물 HTML 정제
- **wrangler** (dev) — 로컬 실행·배포·D1 관리
- **typescript**, **@cloudflare/workers-types** (dev) — 타입 검사
- **playwright-core** (dev) — 브라우저 E2E
- **sharp** (dev) — 이미지 처리
- **Google reCAPTCHA v2** — 가입 시 스팸 방지
- **Google Fonts** — Noto Sans KR, Noto Sans JP
- **Gyeonggi Cheonnyeon Font** — 제목용 로컬 한국어 폰트

---

## 11. 핵심 파일 설명

| 파일 | 역할 |
|---|---|
| `src/index.ts` | Worker 진입점: 미들웨어 순서, 라우트 연결, 오류 처리, Cron |
| `src/routes/*.ts` | API 라우트 (account·me·characters·futureSight·clanBoard) |
| `src/lib/*.ts` | 세션·암호화·비밀번호·캡차·정제·미래시·시도 제한 등 공통 로직 |
| `migrations/0001_initial.sql` | D1 스키마 |
| `wrangler.jsonc` | Worker·D1·정적 파일·Cron 설정 |
| `public/_headers` | 정적 파일 보안·캐시 헤더 (CSP는 `src/lib/security.ts`와 같은 값) |
| `public/index.html` | SPA 셸: 모든 모달과 UI 섹션을 포함하는 단일 HTML |
| `public/js/main.js` | 모든 프론트엔드 로직: API 호출, DOM 조작, 이벤트 처리, 상태 관리 |
| `public/css/main.css` | 전체 스타일시트. 전역 `[hidden]{display:none !important}` |
| `scripts/admin.mjs` | 관리자 계정 생성·승격 |

---

## 12. 버전 및 업데이트 내역

Git 커밋 메시지(`프리코네 한섭 게임공략 웹사이트 / Ver X.X.X`) 기준으로 정리합니다. 최신 항목이 위에 옵니다.

> Ver 0.5.1 ~ Ver 0.5.9.4 의 상세 이력은 이 문서에 기록되지 않았습니다(git log 참고).

### 다음 버전 (미배포) — Cloudflare Workers 무료 플랜으로 이전 (2026-10-22)

**구조**
- Express + Railway PostgreSQL → Hono(Cloudflare Workers) + D1. API 경로·응답 형식은 그대로라 `public/js/main.js`는 바꾸지 않음
- 정적 파일은 Workers static assets로(Worker를 거치지 않음), 헤더는 `public/_headers`
- 스키마는 `migrations/0001_initial.sql`, 관리자는 `npm run admin`(기존 환경 변수 자동 생성 대체)
- 일일 타이머 → Cron Trigger (KST 00:05)
- 캐릭터 이미지 DB(BYTEA) 경로 제거: 정적 라이브러리만 사용
- 기존 데이터는 옮기지 않고 새로 시작 (bcrypt 해시가 새 방식과 호환되지 않음)

**보안**
- 비밀번호 bcrypt(cost 11) → PBKDF2-SHA256 5만 회(Web Crypto)
- 메모리 rate limit·보안 문자·조회수 중복 방지 → D1(토큰·IP는 해시로만 저장)
- 상태를 바꾸는 API에 같은 출처(Origin) 검사 추가
- PII 암호화 키는 `USER_PII_ENCRYPTION_KEY`만 사용(`SESSION_SECRET` 파생·개발용 고정 키 제거)

**최적화**
- 게시물 정제 시 큰 base64를 빼고 정제해 1.7MB 본문 기준 CPU 약 26ms → 5ms (무료 플랜 요청당 10ms 한도)
- 보유 캐릭터 저장을 `json_each` 한 쿼리로 (D1 쿼리당 바인딩 100개 상한 회피)

**회원가입 (2026-10-22 추가)**
- reCAPTCHA 키 없이 보안 문자(+ 시도 제한)만으로 가입을 열 수 있는 `ALLOW_SIGNUP_WITHOUT_RECAPTCHA` 설정 추가, 배포 환경에서 켬

**테스트**
- 단위 테스트를 TypeScript 모듈 대상으로 이식, 기존 Node crypto 구현과 같은 결과인지 확인
- `wrangler dev` 통합 테스트 21개, 브라우저 E2E를 PostgreSQL 대신 wrangler dev로 실행

### 다음 버전 (미배포) — 보안·안정성 정비 (2026-10-17)

**보안**
- 게시물 본문 서버 측 HTML 정제(sanitize-html allowlist) 도입, 기존 게시물은 기동 시 1회 정제
- 회원가입 보안 문자를 `<text>` → 왜곡된 path 글리프로 교체(이전에는 SVG 파싱만으로 100% 자동 통과)
- 운영 환경에서 reCAPTCHA 키가 없으면 회원가입 중단
- 서버 세션 테이블 도입: 로그아웃 시 토큰 즉시 무효화(배포 후 기존 로그인은 한 번 풀림)
- NODE_ENV 누락 시에도 Railway 환경이면 개발용 고정 세션 키를 쓰지 않도록 보강
- 로그인 응답 시간으로 아이디 존재 여부가 드러나지 않도록 보정, 프로필 이미지는 PNG·JPEG·WebP·GIF 만 허용
- 운영 health 응답에서 환경 변수 이름 목록 제거, 공개 `characters.json` 에서 PC 절대 경로 제거
- 의존성 취약점 해소: express 4.22.3, bcrypt 6, sharp 0.35.5 (npm audit 0건), Node 24 로 상향

**버그 수정**
- 정적 이미지가 전역 rate limit 에 포함돼 캐릭터 목록 스크롤만으로 사이트 전체가 429 로 막히던 문제
- 자유 게시판 글쓰기가 숨겨진 「게시물 구분」 검사 때문에 불가능하던 문제
- 클랜전 게시물 분류(연도·월·단계·네임드)가 저장·필터링되지 않던 문제(서버 컬럼·필터 추가)
- 글꼴 크기 8~72 선택이 모두 7단계(48px)로 저장되던 문제
- 텍틱 표 Auto/SET 여부·테마 선택이 저장 후 초기값으로 돌아가던 문제
- 텍틱 표 RANK 입력칸에 타이핑이 되지 않던 문제
- 수정 모드에서 성급 선택·시간 보정·표 삭제 버튼이 동작하지 않던 문제(에디터 위임 핸들러로 통일)
- 표·이미지 삽입 시 `setStartAfter` 예외, 선택 영역이 에디터 밖이면 엉뚱한 곳에 삽입되던 문제
- 게시물 동영상이 CSP 에 막혀 재생되지 않던 문제(`media-src data:` 허용, 1.2MB 제한)
- 잘못된 게시물 id 요청 시 500, 동시 추천 시 500, 새로고침마다 조회수 증가
- 아이디 중복 등으로 가입 실패 시 보안 문자부터 다시 해야 하던 문제
- 비밀번호 눈 아이콘 토글이 동작하지 않던 문제(SVG 에 `.hidden` 프로퍼티 없음)
- 게시물 URL 로 바로 들어오면 로그인 상태여도 댓글 입력란이 숨겨지던 문제
- 검색 결과가 0건이면 검색창이 사라지던 문제, 제목 경고가 30자에서 뜨던 문제(50자로 수정)
- 로그인·가입 경로가 rate limit 하나를 공유해 가입 한 번으로 분당 한도에 걸리던 문제
- `import-characters`: 한 행 실패 시 트랜잭션 전체가 롤백되던 문제(savepoint)
- `create-admin`: 아이디·닉네임이 겹치는 계정을 DELETE 해 게시물까지 지워지던 문제(갱신으로 변경)
- `build-character-library`: 재빌드 시 일부 캐릭터 id 가 바뀌어 보유 목록이 끊길 수 있던 문제(기존 id 유지)

**최적화·정리**
- 게시물 목록 응답에서 작성자 프로필 이미지(data URL) 제거(페이지당 최대 수십 MB → 수 KB)
- 검색을 HTML 원문 대신 평문 컬럼(`content_text`)으로, `%`·`_` 이스케이프
- 정적 파일 캐시 헤더(이미지 1일·폰트 30일), 캐릭터 이미지는 캐시되는 정적 URL 우선
- 큰 사진은 삽입 시 긴 변 1600px JPEG 로 자동 축소, 본문 용량 사전 검사
- 보유 캐릭터 저장을 N회 INSERT → 1회(`unnest`)로, 댓글 작성 후 본문 전체 재조회 제거
- 미래시 로직 `lib/futureSight.js` 분리, `Intl.DateTimeFormat` 재사용
- 인증 확인 공통화(`getSessionUser`/`requireSessionUser`), async 라우트 오류를 JSON 오류 처리기로 일원화
- 중복 함수·죽은 코드 제거, CSS 요소별 `[hidden]` 보정 규칙 11개를 전역 규칙 1개로 통합
- `npm test`(node:test 21개) 추가, `npm run dev` 는 `--watch`

### Ver 0.5.0.3 (2026-06-14)

- **텍틱 기록기 UI 확장**: 텍틱 텍스트 입력 구역(colSpan=2)을 **좌우 반으로 분할**해 새 구역 신설
  - 기존: `시간 | 텍틱 텍스트(colSpan=2) | 오토여부 × 5`
  - 변경: `시간 | 텍틱 텍스트(col 1) | Auto 여부(col 2) | SET 여부 × 5`
  - `createTacticInputRow()`에서 `tacticTextCell`(colSpan=2) → `tacticTextCell`(col 1) + `extraCell`(col 2)로 분리
  - `extraCell` placeholder: `Auto 여부` (중앙 정렬, 폰트 굵게)
  - 기존 `오토여부` placeholder → `SET 여부`로 변경
  - CSS 추가: `.clan-tactic-table__extra-cell` 중앙 정렬 스타일
  - 게시물 상세 읽기 전용 모드에서 새 구역 placeholder 숨김 처리
- **Auto 여부 / SET 여부 드롭다운 UI** 추가
  - `createTacticDropdown(onLabel, offLabel)` 함수: 기본값 O, 라벨 커스텀 가능
  - Auto 여부 드롭다운: `Auto ON` / `Auto OFF`, **항상 표시** (보스 이미지 추가 여부와 무관)
  - SET 여부 드롭다운(×5): `SET ON` / `SET OFF`, 해당 슬롯에 캐릭터 추가 시 표시
  - `updateTacticDropdownVisibility(sourceCell)` 함수로 캐릭터 추가·삭제 시 SET 여부 드롭다운 표시/숨김 처리
  - CSS 추가: `.clan-tactic-table__dropdown` (26px 높이, 중앙 정렬, 포커스 시 분홍 테두리)
  - 읽기 전용 모드: 드롭다운 비활성화 + 회색 배경, placeholder 숨김 처리

### Ver 0.5.0.2 (2026-06-14)

- **텍틱 기록기 시간 입력 구역** 미작동 버그 수정
  - 근본 원인: `createTacticTimeInput()` 함수가 정의되어 있었으나 `createTacticInputRow()`에서 호출되지 않아, 시간 입력 UI가 실제로 생성되지 않았음
  - 수정: `createTacticInputRow()`의 0열 셀에 `createTacticTimeInput()` 호출로 `분:초` 입력 구역 삽입
  - 시간 입력 제한: 최대 1분 30초로 하향 조정 (`TACTIC_TIME_MAX_TOTAL_SEC`: 91 → 90)
  - 분 입력 구역 미입력 시 자동으로 `0` 채움, 초 입력 구역은 패딩 없이 그대로 유지
  - CSS 추가: `.clan-tactic-table__time-input`, `.clan-tactic-table__time-part`, `.clan-tactic-table__time-min`, `.clan-tactic-table__time-sec`, `.clan-tactic-table__time-sep`
  - 게시물 상세 읽기 전용 모드에서 시간 입력 필드 비활성화 시 텍스트 색상 유지

### Ver 0.5.0.1 (2026-06-13)

- 게시물 상세 페이지 **텍틱 기록기 이월타 계산기** 기능 추가
  - 게시물 상세 페이지에서 텍틱 기록기가 존재할 경우 테마 행에 **「이월타 계산기」** 버튼 자동 표시 (흰색 배경, 검정 테두리)
  - 버튼 클릭 시 **이월 시간 입력 팝업** 표시
    - 좌측 상단 「이월타 계산기」 제목, 「이월 시간을 입력해주세요.」 설명 텍스트
    - `분:초` 형식 시간 입력 구역 (최대 1분 30초)
    - 분 구역 미입력 시 자동으로 `0` 채움
    - 취소 버튼: 기본 흰색 배경·빨간색 텍스트·빨간색 테두리, hover 시 빨간색 배경·흰색 텍스트
    - 확인 버튼: 프리코네 분홍(`--pink`) 배경·흰색 텍스트 중앙 정렬

### Ver 0.5.0 (2026-06-13)

**자유 게시판 신설**
- 네비게이션 바 "자유 게시판" → "자유"로 텍스트 축소
- 자유 게시판 전용 패널 추가: 제목/게시물 목록/글쓰기/검색
- 6열 그리드(번호/제목/작성자/날짜/조회/추천, 카테고리 열 없음)
- 글쓰기 페이지에서 자유 게시판일 경우 카테고리 선택 UI 자동 숨김
- `board` 컬럼 추가(`clan`/`free`) → API 필터링 및 게시물 구분
- 헤더 행과 데이터 행 그리드 불일치 수정(`clan-post-header-row--free`)

**클랜전 서브보드 개선**
- `sub_board` 컬럼 추가(`clan-semi`/`clan-fullauto`) → 게시물을 세미오토·플오토 게시판별로 구분
- "전체보기"(`clan-all`) 서브보드 추가 (드롭다운 메뉴) — 플오토·세미오토 구분 없이 모든 게시물 표시
- "자유"(general) 카테고리 삭제 (카테고리 탭 및 서버 유효성 목록에서 제거)
- 클랜전 메인 메뉴 클릭 시 전체보기 게시판으로 이동, 전체보기일 때 `- 전체보기` 부제목 숨김

**게시물 상세 페이지 UIUX 재디자인**
- 게시판명 헤더: 클릭 시 해당 게시판으로 이동 (하이퍼링크 스타일)
- 분홍색 제목 밴드: 카테고리 뱃지(좌측) + 게시물 제목(우측) + 댓글 수 `[N]`
- 메타행: 작성자(좌측) / 조회수 | 댓글 개수 | 작성일시(우측), `|` 구분자, 우측 정렬
- 본문 구역과 배경 구분선 제거 (통합형 디자인)
- 하단 버튼: 수정(검정 테두리), 삭제(빨강 테두리+글자), 글쓰기(분홍 배경+흰 글자), 둥근 모서리

**추천 & 댓글 구역 통합**
- 추천 버튼을 댓글 섹션 내 `.clan-recommend-bar`로 이동
- 댓글 헤딩 형식: `댓글 [N]` (괄호 안에 개수 표시)
- 추천 버튼 시각적 차별화: 미추천=회색 테두리, 추천=분홍 배경+흰 글자
- 계정당 게시물별 1회 추천 토글 (기존 유지)

**게시판 목록 개선**
- "추천" 열 추가 → 클랜전 7열, 자유 6열 그리드
- 게시물 번호 체계 변경: 과거→최신순(#1 = 가장 오래된 글, #N = 최신 글)
- 게시물 목록 제목 20자 초과 시 `......` 말줄임표 처리 (클랜전/자유 공통)
- 게시물 목록 제목 뒤 `[댓글N]` 표시 (분홍색 인라인 뱃지)
- 모든 게시물 셀(카테고리, 작성자, 날짜, 조회수, 추천수) 중앙 정렬
- CSS 중복 선언 제거로 정렬 버그 수정

**제목 길이 확장**: 30자 → 50자 (HTML `maxlength`, JS 유효성 검사, 서버 API)

**버그 수정**
- `clanBoardCurrentSubBoard` TDZ(ReferenceError)로 인한 전체 JS 번들 중단 수정 — 변수 선언을 IIFE 상단으로 이동
- `freeWriteOpenBtn` 이벤트 리스너 누락으로 자유 게시판 글쓰기 버튼 미작동 수정
- 헤더 행 `--free` 클래스 누락으로 인한 자유 게시판 컬럼 정렬 문제 수정

### Ver 0.4.8 (2026-06-10)

- 게시물 등록 후 **텍틱 기록기 읽기 전용 처리** 버그 수정
  - 근본 원인: 등록된 게시물의 텍틱 표 셀에 `contentEditable="true"` 속성이 그대로 남아 있어, 게시물 상세 보기에서도 텍스트 추가 입력이 가능했던 문제
  - 수정: 게시물 상세 렌더링 시 `clan-detail-body` 내 모든 텍틱 표의 `contentEditable="true"` 요소를 `contentEditable="false"`로 변경, input/textarea/select/button 요소를 `disabled` 처리 (`public/js/main.js`)
- 게시물 조회 모드에서 텍틱 기록기 **편집 UI 요소 숨김** (`public/css/main.css`)
  - 테마 선택 드롭다운·삭제 버튼 숨김 (테마 행 배경색은 유지)
  - 보스 이미지 삭제 오버레이 버튼 숨김
  - "+ 텍틱 추가" 버튼 행 숨김
  - 성급 드롭다운 트리거 경계선 제거, 커서 기본값 변경
  - 빈 텍틱 입력 셀·오토여부 셀 placeholder 텍스트 숨김
  - 데미지 입력·보스명 입력 필드 placeholder 텍스트 숨김
  - 비활성화된 입력 필드의 텍스트 색상이 흐려지지 않도록 스타일 보정
- **캐릭터명 자동 줄바꿈** 기능 추가 (`public/js/main.js`, `public/css/main.css`)
  - `formatTacticCharName()` 함수: 한 줄 최대 6자, 공백 기준 줄바꿈 우선
  - 괄호 `(` 앞에서 강제 줄바꿈 (`<br>` 삽입)
  - `(`~`)` 구간은 `<span class="clan-tactic-table__char-name-paren">`으로 감싸 `white-space: nowrap` 적용하여 내부 줄바꿈 방지

### Ver 0.4.6.37 (2026-06-09)

- **캐릭터명 자동 삽입 시 표 경계선 소실 문제 해결**
  - 근본 원인: `contentEditable="false"`인 `<td>`에 `textContent`를 직접 설정할 때 Chromium contentEditable 엔진이 테이블 DOM 정규화(normalization)를 수행하여 `border-collapse` 환경에서 인접 셀 경계선이 사라지는 현상
  - 수정: `<td>` 내부에 항상 `<span class="clan-tactic-table__char-name-text">` 자식을 유지하고, `textContent`는 `<span>`에만 적용하도록 변경
- **데미지 입력 구역 확장으로 인한 이미지 셀 비정상적 세로 확장 문제 해결**
  - `dmgCell`의 `rowSpan=4` 제거, tr2-tr4에 `colSpan=2` placeholder 셀 추가
  - `main-cell` height를 `var(--tactic-image-slot-size)` (82.5px)로 축소
  - `damage-input`의 `min-height: 160px` 제거
- **bossname-input 오버플로우 수정**: `box-sizing: border-box` 추가
- **"+ 텍틱 추가" 버튼 동작 변경**: 버튼 행 바로 위에 새 텍틱 입력 행 삽입, `createTacticInputRow()` 함수 분리
- **텍스트 정렬 및 여백 조정**: tactic-text-cell, auto-cell, rank-input, char-name-cell 패딩 정리
- **데미지 입력 폰트 크기 2배 증가**: `damage-input` font-size 1rem → 2rem

### Ver 0.4.7 (2026-05-31)

- 게시물 작성 **텍틱 캐릭터 선택 팝업** UI 재디자인
  - 제목 **「텍틱 캐릭터 추가하기」**, 「← 뒤로 가기」 제거
  - 제목 아래 **우측 정렬** 검색창 + 검색 아이콘 버튼
  - **10열 × 5행** 스크롤 그리드 유지, 검색 결과 없음 메시지
  - 푸터 **취소 / 확인** 버튼 (검은 배경·흰 글씨·둥근 모서리)
- 텍틱 **성급 선택 UI** 개선: 이전/다음 버튼 → **드롭다운** (테마 선택과 유사)
  - 1~6성 별 아이콘 목록에서 선택, 기본값 **3성**
- **미래시 월별 자동 정리** (`server.js`) 보완
  - **KST(`Asia/Seoul`)** 기준 월 판단
  - **달이 바뀌면** 24시간 제한 없이 즉시 이전 달 데이터 정리
  - 서버 **기동 시 1회** + **매일 KST 00:05** 스케줄 실행

### Ver 0.4.6.1 (2026-05-31)

- 텍틱 **캐릭터 선택 팝업** 레이아웃 깨짐 버그 수정
  - 팝업 시트 폭 **960px**, **10열 × 5행** 보이는 스크롤 영역
  - `bindCharacterImage()` — API URL 우선, 정적 fallback
  - 이미지 없을 때 placeholder 배경 처리

### Ver 0.4.6 (2026-05-31)

- 텍틱 작성기 **UI 깨짐** 버그 수정 (표·슬롯 가로 overflow)
- **작성 구역 가로 확장**: `site-main` max-width **1360px**, `.clan-write-page` **1280px**
- **텍틱 시간 입력** (푸터 1열): `[분] : [초]` 형식, 최대 **1:31**

### Ver 0.4.5 (2026-05-31)

- 캐릭터 슬롯 **성급 선택** 기능 (1~6성, 별 아이콘 표시, 기본 **3성**)
- 캐릭터 슬롯 **RANK 입력** (숫자와 `+`, `-`만 허용)
- 캐릭터 추가/삭제 시 성급·RANK UI 표시/숨김 (`data-tactic-slot` 열 매칭)
- 보스 열 별/RANK 셀 **편집 불가** (`clan-tactic-table__no-edit`, `beforeinput`/`paste`/`keydown` 차단)

### Ver 0.4.4.5 (2026-05-31)

- 텍틱 표 **표기·정렬** 오류 수정
  - 데미지 셀 가운데 정렬·폰트 크기 조정
  - 보스명/별/RANK 셀 정렬·세로 가운데 정렬 정리

### Ver 0.4.4.4 (2026-05-31)

- 텍틱 표 **보스 전용 열** 분리 및 행 배치 정리
  - 1행: 보스 이미지, 2행: 보스명, 3행: 별, 4행: RANK (보스 열)
  - 캐릭터 슬롯 5열(col 1~5) 유지

### Ver 0.4.4.3 (2026-05-31)

- 데미지 입력 **버그 수정** (라벨 제거, placeholder 정리)
- 보스명 입력 필드 추가 (보스 열, 최대 8자)
- 성급/RANK **가이드 라벨** UI 베타 (보스 열 고정 ★ / RANK 표시)

### Ver 0.4.4.2 (2026-05-31)

- 텍틱 표 격자 **행·열 span** 조정 (중간 레이아웃 정리)

### Ver 0.4.4.1 (2026-05-31)

- 텍틱 UIUX **버그 수정** (캐릭터 버튼 라벨 등)

### Ver 0.4.4 (2026-05-31)

- 게시물 작성 페이지 **텍틱 작성하기** UIUX 개선
  - 목표 레이아웃에 맞게 표 구조 단순화: 6행·복잡 `rowspan` → **4행×6열** 격자 + 좌측 데미지 셀(`rowspan=4`) + 하단 푸터
  - 테마 헤더: 좌측 라벨 제거, **우측 테마 선택 드롭다운**만 표시
  - 데미지 입력 placeholder를 `텍틱 데미지를 입력하세요.`로 변경, **가운데 정렬**
  - 슬롯 버튼 문구 변경: `+ 보스` / `+ 캐릭터` → **`보스 이미지`** / **`캐릭터 추가`**
  - 보스명 placeholder를 `보스명 입력`으로 변경
- **데미지 입력** 기능 추가 (숫자만, 천 단위 콤마, 최대 10자리)
- **보스명 입력** 기능 추가
- 성급/RANK **가이드 UI** 초안 추가
- 텍틱 표 **열 너비** 조정
  - 보스·캐릭터 슬롯 열(6열)을 이미지 크기(**64px**)에 맞게 고정
  - `colgroup` 도입 및 `table-layout: fixed`로 슬롯 열 폭 고정, **남는 가로 공간을 데미지 표시 구역**에 할당
  - 버튼·이미지 래퍼·그리드 셀 패딩을 64×64px에 맞게 정리

### Ver 0.4.3 (2026-05-30)

- 게시물 작성 페이지 **텍틱 작성하기** 기능 추가 (초안)
  - 웹 링크 버튼 우측에 **텍틱 작성하기** 툴바 버튼 추가
  - 클릭 시 contentEditable 에디터에 텍틱 표 UI 삽입
  - 표 구조: 상단 좌측 대형 셀(`rowspan=4`) + 우측 4행×6열 격자(1행 높이 확대) + 하단 푸터(좁은 셀 + 넓은 셀)
  - 작성 에디터·게시물 상세 본문 공통 CSS(`.clan-tactic-table`) 적용

### Ver 0.4.2.2 (2026-05-29)

- 게시물 작성 페이지 UIUX 수정
  - UI 간격 조정
  - UI 버튼 사용자 상호작용 방식 변경
  - 게시물 내용 작성 구역 1단 UI → 2단 UI(툴바 2행 분리)
- 메인 페이지 UIUX 버그 수정

> **참고 (2026-05-30)**: Ver 0.4.3 ~ Ver 0.4.6.1 구간은 원격 `master`에서 Ver 0.4.2.2로 롤백된 뒤, Ver 0.4.3부터 다시 버전을 올려 재개했습니다.

### Ver 0.4.2.1 (2026-05-29)

- 게시물 작성 페이지를 독립 패널로 분리
  - 기존 게시판·작성 통합 화면 → 게시판 페이지 / 게시물 작성 페이지 분리

### Ver 0.4.2 (2026-05-29)

- 게시물 작성 페이지 디자인 개선
- 게시판 페이지 UIUX 버그 수정 (게시물 가이드 UI 미표시)

### Ver 0.4.1.2

- 마이페이지 버그 수정
- 마이페이지 → 메인페이지 이동 기능 추가

### Ver 0.4.1.1

- 게시판 팝업 UI 수정
- 게시물 정보 가이드 UI 미노출 버그 수정

### Ver 0.4.1

- 게시판 UIUX 수정
- 페이지당 게시물 개수 제한, 페이지 넘김, 게시물 검색 기능 추가

### Ver 0.4.0

- 클랜전 페이지 **게시판 기능** 추가 (베타)
  - 게시물 작성·목록·상세·댓글·추천 API 및 UI
  - 리치 텍스트 contentEditable 에디터 도입

### Ver 0.3.3

- 웹사이트 DDoS 방어(rate limiter 등)

### Ver 0.3.2

- `PROJECT_INDEX.md` 프로젝트 인덱스 문서 추가

### Ver 0.3.1.x

- 캐릭터 데이터베이스 버그 수정 및 보유 캐릭터 검색 기능 수정

### Ver 0.3.1

- 미래시 UI 캐릭터 이미지 확대

### Ver 0.3.0

- 보유 캐릭터 DB 기반 맞춤형 미래시 UI
- 마이페이지 캐릭터 업데이트 메뉴 검색 기능 추가

### Ver 0.2.x

- 미래시 UI/UX 개선, 프라이즈·동시픽업 표시, 회원가입·닉네임 일본어 지원 등

### Ver 0.1.x ~ Ver 0.0.1

- 초기 사이트 구축: Future Sight, 회원가입/로그인, 마이페이지, 관리자 기능, 캐릭터 라이브러리 등 핵심 기능 구현
