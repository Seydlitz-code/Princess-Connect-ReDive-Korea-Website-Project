/**
 * Railway 에서 웹 서비스가 Postgres 에 붙기 위해 필요한 변수 연결 안내(콘솔 출력).
 * 코드 변경 없이 대시보드 설정만으로 해결되는 경우가 대부분입니다.
 *
 *   npm run railway:db-hint
 */

const lines = [
  '── Railway: 웹 앱 ↔ Postgres 연결 체크리스트 ──',
  '',
  '1) Railway 프로젝트에서 GitHub 로 배포된 웹 서비스( Node ) 카드를 연다.',
  '2) Variables(또는 환경 변수) 탭 → "New Variable" 또는 "Add Variable".',
  '3) "Reference" / 다른 서비스 변수 참조 를 선택한다.',
  '4) 소스: 같은 프로젝트의 Postgres 플러그인 서비스.',
  '5) 웹 서비스 쪽 변수 이름: DATABASE_PRIVATE_URL (권장)',
  '   참조할 값: Postgres 서비스의 DATABASE_PRIVATE_URL',
  '   (UI 에서 ${{ Postgres.DATABASE_PRIVATE_URL }} 형태로 보일 수 있음.',
  '    Postgres 카드 이름이 다르면 Postgres 부분이 해당 서비스 이름으로 바뀐다.)',
  '',
  '대안: 같은 방식으로 DATABASE_URL 을 참조해도 된다.',
  '',
  '6) 변수 저장 후 웹 서비스를 재배포(Redeploy)한다.',
  '7) 브라우저에서 배포 URL 의 /api/health 를 연다.',
  '   • database.poolReady 가 true 여야 회원가입·DB API 가 동작한다.',
  '   • false 이면 database.dbEnvHints 와 database.lastDbInitError 를 본다.',
  '',
  '로컬 또는 Railway 셸에서 연결 테스트:',
  '   DATABASE_PRIVATE_URL="postgresql://..." npm run db:check',
  '',
];

console.log(lines.join('\n'));
