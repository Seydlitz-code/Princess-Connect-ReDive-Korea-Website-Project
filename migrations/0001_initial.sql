-- 첫 스키마 (기존 server.js의 ensureSchema를 D1(SQLite)로 옮김).
-- id는 Worker가 crypto.randomUUID()로 만든 UUID 문자열이다.
-- 시각은 ISO 8601 UTC 문자열(밀리초 포함)로 저장한다. 문자열 비교로 순서가 맞는다.
-- 메모리에 두던 시도 제한·보안 문자·조회수 중복 방지 기록은 Workers에서 요청마다 다른 isolate가 처리할 수 있어 D1에 둔다.

-- 회원. 아이디·닉네임은 평문으로 저장하지 않는다.
-- *_blind: 중복 확인·로그인 조회용 HMAC-SHA256 (src/lib/pii.ts), *_cipher: 화면 표시용 AES-256-GCM 암호문
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  username_blind  TEXT NOT NULL UNIQUE,
  nickname_blind  TEXT NOT NULL UNIQUE,
  username_cipher TEXT NOT NULL,
  nickname_cipher TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  -- 프로필 이미지 data URL (최대 600,000자)
  profile_image   TEXT,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 로그인 세션. 쿠키는 HMAC 서명만 확인하고, 로그아웃하면 이 행을 지워 쿠키를 무효로 만든다.
CREATE TABLE user_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions (expires_at);

-- 보유 캐릭터. 캐릭터 목록은 정적 라이브러리(public/data/characters.json)라 외래 키 대신 저장 전에 id를 확인한다.
CREATE TABLE user_owned_characters (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, character_id)
) WITHOUT ROWID;

-- 미래시 화면 데이터(JSON). 행은 하나뿐이다.
CREATE TABLE site_future_sight (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 게시판 글. content는 저장 전에 정제한 HTML(이미지·동영상 data URL 포함), content_text는 검색용 평문이다.
CREATE TABLE clan_board_posts (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  board        TEXT NOT NULL DEFAULT 'clan',
  sub_board    TEXT NOT NULL DEFAULT 'clan-fullauto',
  category     TEXT NOT NULL DEFAULT 'none',
  year         TEXT,
  month        TEXT,
  stage        TEXT,
  named        TEXT,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  view_count   INTEGER NOT NULL DEFAULT 0,
  is_pinned    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT
);
CREATE INDEX idx_clan_board_posts_list ON clan_board_posts (board, is_pinned, created_at DESC);
CREATE INDEX idx_clan_board_posts_author ON clan_board_posts (author_id);

CREATE TABLE clan_board_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES clan_board_posts (id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_clan_board_comments_post ON clan_board_comments (post_id, created_at);
CREATE INDEX idx_clan_board_comments_author ON clan_board_comments (author_id);

CREATE TABLE clan_board_likes (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL REFERENCES clan_board_posts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, post_id)
) WITHOUT ROWID;
-- 추천 PK는 (user_id, post_id)라 게시물별 추천 수 집계에는 post_id 인덱스가 따로 필요하다.
CREATE INDEX idx_clan_board_likes_post ON clan_board_likes (post_id);

-- 같은 사람이 같은 글을 새로고침해도 조회수가 계속 오르지 않게 마지막 집계 시각을 남긴다 (6시간).
-- viewer_key: 'u:<회원 id>' 또는 'ip:<IP의 HMAC>' (IP 원문은 저장하지 않는다)
-- viewed_at: 밀리초 단위 UNIX 시간 (시간 창 계산을 숫자 비교 한 번으로 하기 위해)
CREATE TABLE post_view_marks (
  viewer_key TEXT NOT NULL,
  post_id    TEXT NOT NULL REFERENCES clan_board_posts (id) ON DELETE CASCADE,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (viewer_key, post_id)
) WITHOUT ROWID;
CREATE INDEX idx_post_view_marks_post ON post_view_marks (post_id);
CREATE INDEX idx_post_view_marks_viewed_at ON post_view_marks (viewed_at);

-- 시도 제한 카운터 (고정 1분 창). window_start는 밀리초 단위 UNIX 시간이다.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);

-- 회원가입 보안 문자: 'challenge'(문제, 정답 해시 보관)와 'pass'(1단계 통과 토큰).
-- token_hash: 토큰 원문의 SHA-256. 원문은 브라우저만 가진다.
-- expires_at: 밀리초 단위 UNIX 시간
CREATE TABLE signup_tokens (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('challenge', 'pass')),
  answer_hash TEXT,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_signup_tokens_expires_at ON signup_tokens (expires_at);
