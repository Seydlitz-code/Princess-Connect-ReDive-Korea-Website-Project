-- Railway Postgres「Query」또는 psql에서 1회 실행 후 웹 서비스를 재시작하세요.
-- 서버 기동 시 관리자 행이 생성되면 이 테이블의 행은 자동 삭제되며, 평문 비밀번호는 DB에 남지 않습니다.
-- 웹 Variables의 ADMIN_BOOTSTRAP_PASSWORD 는 필요 없습니다(여전히 DATABASE_URL·SESSION_SECRET 등은 필요).
--
-- 비밀번호·아이디는 예시이므로 운영 값으로 바꾸세요.

INSERT INTO admin_install_seed (id, username, nickname, password_plain)
VALUES (1, 'seydlitz', '릴리프', '여기에_비밀번호_평문')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  nickname = EXCLUDED.nickname,
  password_plain = EXCLUDED.password_plain;
