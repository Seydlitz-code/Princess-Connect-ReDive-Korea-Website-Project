-- PostgreSQL 을 쓰는 환경에서만 실행하세요. (정적 characters.json 전용 배포는 불필요)
-- 동일 이름 중복: 미소기.png 제거, 미소기.jpg UUID 로 보유 데이터를 합칩니다.
--
-- 유지: 38c0125d-f377-5e53-a18a-e85dc9d35157 (미소기.jpg)
-- 삭제: 9d70de3a-d68e-540f-b776-cb2e35514b94 (미소기.png)

BEGIN;

UPDATE user_owned_characters u
SET character_id = '38c0125d-f377-5e53-a18a-e85dc9d35157'::uuid
WHERE character_id = '9d70de3a-d68e-540f-b776-cb2e35514b94'::uuid
  AND NOT EXISTS (
    SELECT 1
    FROM user_owned_characters x
    WHERE x.user_id = u.user_id
      AND x.character_id = '38c0125d-f377-5e53-a18a-e85dc9d35157'::uuid
  );

DELETE FROM user_owned_characters
WHERE character_id = '9d70de3a-d68e-540f-b776-cb2e35514b94'::uuid;

DELETE FROM characters WHERE id = '9d70de3a-d68e-540f-b776-cb2e35514b94'::uuid;

COMMIT;
