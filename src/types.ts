/** 바인딩(Env)과 요청마다 미들웨어가 채우는 값(AppEnv.Variables)의 타입 */
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 세션 쿠키 서명 키. `wrangler secret put SESSION_SECRET`(배포), `.dev.vars`(로컬) */
  SESSION_SECRET?: string;
  /** 아이디·닉네임 암호화 키 (64자리 16진수 권장). 바꾸면 기존 계정을 찾을 수 없으므로 한 번 정하면 유지한다. */
  USER_PII_ENCRYPTION_KEY?: string;
  RECAPTCHA_SITE_KEY?: string;
  RECAPTCHA_SECRET_KEY?: string;
  /** 'development'면 reCAPTCHA 없이 회원가입을 연다. 배포 환경에는 넣지 않는다. */
  ENVIRONMENT?: string;
  /** 'true'면 배포 환경에서도 reCAPTCHA 없이 보안 문자만으로 회원가입을 연다 (wrangler.jsonc vars). */
  ALLOW_SIGNUP_WITHOUT_RECAPTCHA?: string;
};

export type SessionUser = { id: string; role: string };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** undefined: 아직 조회 안 함, null: 로그인 안 함 */
    sessionUser: SessionUser | null | undefined;
  };
};
