/** 회원 입력 규칙 (기존 server.js 상수 이식). scripts/admin.mjs도 같은 규칙을 쓴다. */

/** 아이디: 영문 8~20자 */
export const USERNAME_PATTERN = /^[a-zA-Z]{8,20}$/;
/** 로그인 입력 아이디 최대 길이: 64자 (이보다 길면 조회 없이 실패) */
export const LOGIN_USERNAME_MAX = 64;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;
export const PASSWORD_MIN = 8;
/** 비밀번호 최대 길이: 72자 (기존 bcrypt 입력 상한을 그대로 둔다) */
export const PASSWORD_MAX = 72;
/** 프로필 이미지 data URL 최대 길이: 600,000자 (약 440KB 이미지) */
export const MAX_PROFILE_DATA_URL_LENGTH = 600_000;
const PROFILE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/** 한글·영문·일본어(히라가나·가타카나·반각 가타카나·한자) */
const NICKNAME_CHARS_PATTERN = /^[가-힣ㄱ-ㆎa-zA-Z぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]+$/;

export const NICKNAME_CHARS_ERROR = '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.';
export const PROFILE_TOO_LARGE_ERROR = '프로필 이미지가 너무 큽니다. 더 작은 이미지를 사용해 주세요.';
export const PROFILE_FORMAT_ERROR = '프로필 이미지는 PNG·JPEG·WebP·GIF base64 데이터 URL 형식이어야 합니다.';

export function isValidNicknameChars(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && NICKNAME_CHARS_PATTERN.test(trimmed);
}

export function isValidProfileDataUrl(value: string): boolean {
  return PROFILE_DATA_URL_PATTERN.test(value);
}
