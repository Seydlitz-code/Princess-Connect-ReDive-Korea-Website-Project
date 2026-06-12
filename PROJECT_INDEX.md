# Project Index — Princess Connect! Re:Dive Korea Server Strategy Website

> **패키지명**: `priconne-kr-strategy-site`  
> **진입점**: `server.js`  
> **현재 버전**: Ver 0.5.0  
> **언어**: JavaScript (Node.js, TypeScript 미사용)  
> **배포 대상**: Railway (cloud), Docker / 로컬 실행 가능  
> **생성일**: 2026-05-20

---

## 1. 프로젝트 개요

본 프로젝트는 **Cygames의 모바일 게임 "Princess Connect! Re:Dive" 한국 서버**를 위한 **미래시(Future Sight) 전략 가이드 사이트**입니다. 일본/중국 서버의 과거 배너 이력을 기반으로, 한국 서버에 곧 출시될 신규 캐릭터 배너와 재실시 이벤트, 6성 해방 퀘스트 등을 표 형태로 시각화하여 제공합니다.

### 주요 기능
- **Future Sight 테이블**: 월별 캐릭터/이벤트 로드맵
- **소유 캐릭터 관리**: 가입 유저가 자신이 보유한 캐릭터를 체크하여 관리
- **관리자 기능**: Future Sight 데이터 직접 편집, 캐릭터 이미지 관리
- **회원 가입/로그인**: 자체 세션 인증 (HMAC-SHA256 signed cookie)
- **2단계 봇 방지**: 커스텀 SVG 캡차 + Google reCAPTCHA v2 (선택)

---

## 2. 기술 스택

| 계층 | 기술 |
|---|---|
| **런타임** | Node.js >=18 |
| **HTTP 프레임워크** | Express 4.21 |
| **데이터베이스** | PostgreSQL (`pg` 8.13) |
| **인증/세션** | 커스텀 HMAC-SHA256 signed cookie (Passport.js 미사용) |
| **비밀번호 해싱** | bcrypt |
| **PII 암호화** | AES-256-GCM (유저명/닉네임 암호화 + blind HMAC 인덱싱) |
| **캡차** | 커스텀 SVG 캡차 + Google reCAPTCHA v2 |
| **이미지 처리** | Sharp (devDependency, 로고 처리용) |
| **프론트엔드** | Vanilla JS (프레임워크 없음, 빌드 스텝 없음), 순수 CSS |
| **폰트** | Google Fonts (Noto Sans KR/JP), Gyeonggi Cheonnyeon 폰트 |
| **컨테이너** | Docker (node:20-alpine) |
| **배포** | Nixpacks (Railway 네이티브) |

---

## 3. 디렉토리 구조

```
/
├── server.js                     # 메인 Express 서버 (~2093 라인)
├── package.json                  # 의존성 및 스크립트
├── Dockerfile                    # Docker 빌드 (node:20-alpine, port 8080)
├── nixpacks.toml                 # Railway Nixpacks 설정
├── .dockerignore
├── .gitignore
│
├── lib/                          # 백엔드 라이브러리 모듈
│   ├── dbConfig.js               # PostgreSQL 연결 문자열 해석 (멀티 환경)
│   ├── sessionAuth.js            # HMAC 서명 세션 쿠키 관리
│   ├── userPiiCrypto.js          # AES-256-GCM PII 암호화 + blind HMAC 인덱싱
│   ├── userPiiSchema.js          # PII 컬럼 DB 스키마 마이그레이션
│   ├── recaptcha.js              # Google reCAPTCHA v2 siteverify 클라이언트
│   ├── signupCaptcha.js          # 커스텀 SVG 캡차 (챌린지/응답)
│   └── charactersLibrary.js      # 정적 파일 기반 캐릭터 라이브러리 로더
│
├── public/                       # 정적 파일 (Express 제공)
│   ├── index.html                # 단일 HTML 페이지 (SPA 셸) — 837 라인
│   ├── css/main.css              # 모든 스타일 — 3890 라인
│   ├── js/main.js                # 모든 클라이언트 사이드 JS (IIFE) — 3879 라인
│   ├── data/characters.json      # 정적 캐릭터 라이브러리 매니페스트
│   ├── characters/               # 캐릭터 이미지 (JPEG/PNG)
│   ├── fonts/gyeonggi-cheonnyeon/ # 로컬 폰트
│   └── images/
│       ├── logo.png
│       └── future-main/          # 배너 배경 이미지
│
├── scripts/                      # 유틸리티 / CLI 스크립트
│   ├── create-admin.js           # 관리자 계정 생성
│   ├── build-character-library.js # 정적 캐릭터 라이브러리 빌드
│   ├── import-characters.js      # 캐릭터 이미지를 PostgreSQL로 가져오기
│   ├── check-db.js               # DB 연결 확인
│   ├── process-logo.js           # 로고 이미지 처리
│   ├── railway-db-vars-hint.js   # Railway 환경 변수 설정 가이드
│   └── ...
│
└── .idea/                        # JetBrains IDE 설정
```

---

## 4. 아키텍처

### 4.1 서버 아키텍처 (`server.js`)

**단일 파일 Express 서버**로, 모든 라우트가 인라인으로 정의되어 있습니다 (약 2093 라인). 서버 기동 시퀀스는 다음과 같습니다:

1. `initDb()` — 재시도 로직을 통해 PostgreSQL 연결 (`PG_INIT_RETRIES`로 설정 가능)
2. `ensureSchema()` — DB 테이블 자동 생성/마이그레이션 (`users`, `characters`, `user_owned_characters`, `site_future_sight`)
3. `bootstrapAdminFromEnvIfNeeded()` — 환경 변수로 관리자 계정 자동 생성 (Railway 친화적)
4. `readCharacterLibrarySync()` — `public/data/characters.json`에서 정적 캐릭터 라이브러리 로드 시도 (DB 조회보다 빠름)
5. HTTP 서버 시작

**Graceful Shutdown**: SIGTERM/SIGINT 시그널을 받으면 DB 연결을 정리하고 서버를 종료합니다.

### 4.2 API 엔드포인트

| 메서드 | 라우트 | 목적 |
|---|---|---|
| GET | `/api/config` | 공개 런타임 설정 (reCAPTCHA site key) |
| GET | `/api/signup/captcha` | SVG 캡차 챌린지 생성 |
| POST | `/api/signup/verify-step1` | 캡차 검증 → step pass 토큰 발급 |
| POST | `/api/register` | 전체 가입 (2단계: 캡차 + reCAPTCHA + 유저 데이터) |
| POST | `/api/login` | 로그인 (HMAC 서명 쿠키 세션 발급) |
| POST | `/api/logout` | 세션 쿠키 제거 |
| GET | `/api/me` | 현재 유저 프로필 조회 |
| PATCH | `/api/me` | 프로필 수정 (닉네임 + 프로필 이미지) |
| GET | `/api/me/owned-characters` | 유저 소유 캐릭터 목록 조회 |
| PATCH | `/api/me/owned-characters` | 소유 캐릭터 업데이트 (전체 교체) |
| GET | `/api/users/check` | 유저명/닉네임 사용 가능 여부 확인 |
| GET | `/api/characters` | 전체 캐릭터 목록 조회 (라이브러리 또는 DB) |
| GET | `/api/characters/:id/image` | 캐릭터 이미지 제공 (정적 파일 또는 DB BLOB) |
| GET | `/api/future-sight` | Future Sight 로드맵 데이터 조회 |
| PUT | `/api/admin/future-sight` | 관리자: Future Sight 데이터 수정 |
| GET | `/api/clan-board/posts` | 게시물 목록 조회 (`?board=`, `?sub_board=`, `?category=`, `?search=`, `?page=`, `?limit=`) |
| GET | `/api/clan-board/posts/:id` | 게시물 상세 조회 |
| POST | `/api/clan-board/posts` | 게시물 작성 (`board`, `sub_board`, `title`, `content`, `category`) |
| PATCH | `/api/clan-board/posts/:id` | 게시물 수정 |
| DELETE | `/api/clan-board/posts/:id` | 게시물 삭제 |
| PATCH | `/api/clan-board/posts/:id/view` | 조회수 증가 |
| POST | `/api/clan-board/posts/:id/likes` | 추천 토글 (계정당 1회) |
| GET | `/api/clan-board/posts/:id/comments` | 댓글 목록 조회 |
| POST | `/api/clan-board/posts/:id/comments` | 댓글 작성 |
| GET | `/api/health` | 헬스 체크 + DB 진단 정보 |
| GET | `/*` | SPA 폴백 → `index.html` 제공 |

### 4.3 데이터베이스 스키마

`ensureSchema()`에 의해 자동 생성되는 5개의 테이블:

- **`users`** — id (UUID PK), username, nickname, password_hash, profile_image, role ('user'/'admin'), created_at + PII 컬럼
- **`characters`** — id (UUID PK), name (UNIQUE), image_mime, image_data (BYTEA), updated_at
- **`clan_board_posts`** — id (UUID PK), author_id (FK), title (VARCHAR 200), content (TEXT), category (VARCHAR 32), sub_board (VARCHAR 32, `clan-semi`/`clan-fullauto`), board (VARCHAR 32, `clan`/`free`), view_count, is_pinned, created_at, updated_at
- **`clan_board_comments`** — id (UUID PK), post_id (FK), author_id (FK), content (TEXT), created_at
- **`clan_board_likes`** — user_id (FK), post_id (FK), created_at; composite PK (계정당 게시물별 1회 추천)
- **`user_owned_characters`** — user_id (FK), character_id (UUID), created_at; composite PK
- **`site_future_sight`** — 싱글톤 행 (id=1 CHECK 제약), data (JSONB), updated_at
- **PII 컬럼** (`ensureUserPiiSchema`에 의해 추가): `username_blind`, `nickname_blind`, `username_cipher`, `nickname_cipher` — 부분 unique 인덱스 포함

### 4.4 인증 및 보안

**세션**: 커스텀 구현 — HMAC-SHA256 서명 토큰을 HttpOnly 쿠키(`priconne_sid`)에 저장. 7일 만료, SameSite=Lax, 프로덕션 환경에서 Secure.

**PII 보호**: 유저명과 닉네임은 AES-256-GCM으로 암호화되어 저장됩니다. 동시에 "blind index"(HMAC 기반)를 사용하여 평문을 노출하지 않고 중복 검사를 수행합니다. 마이그레이션 후 평문 컬럼은 NULL로 설정됩니다. 이를 통해 DB가 유출되더라도 개인 식별 정보(PII)가 보호됩니다.

**회원가입 플로우** (2단계 봇 방지):
1. **1단계**: 커스텀 SVG 캡차 (무작위 5자리 영숫자, 노이즈 라인/회전이 적용된 SVG) → `stepPassToken` 획득
2. **2단계**: 선택적 Google reCAPTCHA v2 → 전체 가입 제출

**봇 방지**: 인메모리 챌린지 맵 + TTL (캡차 8분, step pass 30분).

---

## 5. 데이터 흐름

### 5.1 캐릭터 데이터 (두 가지 모드)

1. **정적 라이브러리** (우선): `public/data/characters.json` + `public/characters/*.jpg/png`. 서버 기동 시 Map에 로드됩니다. `res.sendFile()`로 직접 정적 파일을 제공하여 더 빠릅니다.
2. **PostgreSQL**: `characters` 테이블에 BYTEA로 이미지 저장. 정적 라이브러리를 사용할 수 없을 때 폴백으로 사용됩니다.

### 5.2 Future Sight 데이터

JSONB 형식으로 `site_future_sight` 싱글톤 테이블에 저장됩니다. `applyFutureSightMonthMaintenance()`가 매일 자동으로 월 인덱스를 조정하고 오래된 항목을 제거합니다.

### 5.3 전체 데이터 흐름

```
PostgreSQL / 정적 라이브러리
    ↓
server.js (미들웨어 / API 핸들러)
    ↓
JSON API 응답
    ↓
Vanilla JS (fetch) → DOM 조작
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

단일 파일 (5149 라인). CSS 커스텀 프로퍼티를 사용한 테마 설정. 미디어 쿼리를 통한 완전한 반응형 디자인. 프리프로세서나 CSS 프레임워크를 사용하지 않습니다. 클랜전·자유 게시판 게시물 목록 그리드, 게시물 상세 페이지, 텍틱 표(`.clan-tactic-table`), 추천·댓글 통합 레이아웃 스타일 포함.

---

## 7. 사용 가능한 스크립트

| 명령어 | 동작 |
|---|---|
| `npm start` / `npm run dev` | 서버 시작 (`node server.js`) |
| `npm run build:logo` | Sharp를 통한 로고 이미지 처리 |
| `npm run import:characters` | 로컬 폴더의 캐릭터 이미지를 PostgreSQL로 가져오기 |
| `npm run build:characters` | 정적 캐릭터 라이브러리 빌드 (JSON 매니페스트 + 이미지 복사) |
| `npm run bootstrap:admin` | 관리자 계정 생성/업데이트 |
| `npm run db:check` | PostgreSQL 연결 테스트 |
| `npm run railway:db-hint` | Railway 설정 안내 출력 |

**테스트, 린트, 타입체크 스크립트는 설정되어 있지 않습니다.**

---

## 8. 빌드 및 배포

### 8.1 Docker

- 베이스 이미지: `node:20-alpine`
- 실행: `npm ci --omit=dev`, expose 8080, `CMD ["node", "server.js"]`
- SIGTERM/SIGINT를 통한 Graceful Shutdown 지원

### 8.2 Nixpacks (Railway)

- 설치 단계: `npm ci`
- 시작 명령: `node server.js`

### 8.3 필수 환경 변수

| 변수명 | 용도 |
|---|---|
| `DATABASE_PRIVATE_URL` 또는 `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `SESSION_SECRET` | 세션 서명 키 (로그인에 필수) |
| `USER_PII_ENCRYPTION_KEY` | PII 암호화 키 (없으면 `SESSION_SECRET`에서 파생) |
| `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA (선택) |
| `ADMIN_BOOTSTRAP_PASSWORD` | 최초 배포 시 관리자 자동 생성 |
| `PORT` | 기본 3000 (Docker에서는 8080) |

---

## 9. 주요 설계 패턴

1. **듀얼 캐릭터 데이터 소스**: 정적 파일 라이브러리 (더 빠름) vs PostgreSQL BLOB — API 소비자에게 완전히 투명하게 동작
2. **PII 우선 아키텍처**: 모든 개인 데이터(유저명, 닉네임)는 저장 시 암호화됩니다. 중복 검사는 Blind HMAC 인덱스로 수행
3. **커스텀 캡차**: 외부 서비스 의존도를 낮추기 위해 자체 생성 SVG 캡차를 사용, Google reCAPTCHA를 추가 보안 계층으로 제공
4. **Graceful Startup**: 설정 가능한 재시도 횟수/지연을 통한 DB 연결 재시도. DB를 사용할 수 없는 경우에도 graceful degradation (헬스 엔드포인트에서 진단 정보 반환)
5. **자동 마이그레이션 스키마**: 기동 시 테이블이 자동 생성/변경됨 — 별도의 마이그레이션 도구 불필요
6. **Admin env 부트스트랩**: 최초 배포 시 환경 변수를 통한 무중단 관리자 계정 생성
7. **Vanilla JS SPA**: 클라이언트 사이드 라우터 없이 DOM toggling만으로 구현. 저복잡도, 저의존성 설계
8. **한국어/일본어 이중 언어 UI**: 네비게이션 레이블과 안내문이 한국어와 일본어로 표시됨
9. **Canvas 기반 이미지 크롭**: 클라이언트 사이드에서 원형 프로필 이미지 크롭, 줌/회전/이동 기능
10. **Future Sight 자동 유지보수**: 월 인덱스가 매일 자동으로 전진하여 콘텐츠가 오래되지 않도록 관리
11. **마이페이지 헤더 전환**: 마이페이지 라우트에서 상단 네비게이션을 숨기고 "마이페이지" 타이틀로 대체, 로고/링크 클릭 시 메인 페이지로 SPA 이동
12. **리치 텍스트 게시물 에디터**: contentEditable 기반 리치 텍스트 에디터. 이미지/동영상 파일 삽입(Data URL), 웹 링크 삽입, 텍틱 표 삽입, 폰트 크기(8~72, 28단계), 볼드/이탤릭/밑줄/취소선 서식, 제목 50자 제한
13. **멀티 보드 아키텍처**: `board` 컬럼으로 게시판 유형 구분(`clan`/`free`), `sub_board`로 클랜전 하위 게시판 구분(`clan-semi`/`clan-fullauto`). 단일 API 엔드포인트에서 쿼리 파라미터로 필터링하여 확장성 확보
14. **서브보드 라우팅**: 클라이언트에서 `currentBoardContext`로 현재 게시판 컨텍스트 추적. 드롭다운 메뉴로 세미오토·플오토·전체보기 전환. 게시물 작성 시 `board` + `sub_board` 컨텍스트 자동 반영
15. **과거→최신 번호 체계**: 게시판 목록의 게시물 번호를 `total - offset - index` 공식으로 산출, 오래된 게시물부터 #1로 시작하는 역순 번호 매김
16. **통합 추천·댓글 레이아웃**: 추천 버튼과 댓글 헤딩을 단일 `.clan-recommend-bar`에 배치, 레이아웃 단순화 및 시각적 응집도 향상

---

## 10. 외부 의존성 및 API

- **express** — HTTP 서버 프레임워크
- **pg** — PostgreSQL 클라이언트
- **bcrypt** — 비밀번호 해싱
- **sharp** (dev) — 이미지 처리
- **Google reCAPTCHA v2** — 가입 시 선택적 스팸 방지
- **Google Fonts** — Noto Sans KR, Noto Sans JP
- **Gyeonggi Cheonnyeon Font** — 제목용 로컬 한국어 폰트

---

## 11. 핵심 파일 설명

| 파일 | 라인 수 | 역할 |
|---|---|---|
| `server.js` | ~2334 | 전체 백엔드 로직: 서버 기동, DB 스키마, 모든 API 라우트, 정적 파일 제공, 세션 관리 |
| `public/index.html` | ~915 | SPA 셸: 모든 모달과 UI 섹션을 포함하는 단일 HTML |
| `public/js/main.js` | ~5372 | 모든 프론트엔드 로직: API 호출, DOM 조작, 이벤트 처리, 상태 관리 |
| `public/css/main.css` | ~5149 | 전체 스타일시트: 레이아웃, 테마, 반응형 디자인, 모달, 애니메이션, 텍틱 표 |
| `lib/sessionAuth.js` | — | HMAC-SHA256 세션 쿠키 생성/검증 유틸리티 |
| `lib/userPiiCrypto.js` | — | AES-256-GCM 암호화 + Blind HMAC 인덱싱 |
| `lib/signupCaptcha.js` | — | 커스텀 SVG 캡차 생성 및 검증 |
| `lib/charactersLibrary.js` | — | 정적 캐릭터 라이브러리 로더 |
| `lib/dbConfig.js` | — | 환경별 PostgreSQL 연결 문자열 해석 |

---

## 12. 버전 및 업데이트 내역

Git 커밋 메시지(`프리코네 한섭 게임공략 웹사이트 / Ver X.X.X`) 기준으로 정리합니다. 최신 항목이 위에 옵니다.

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
