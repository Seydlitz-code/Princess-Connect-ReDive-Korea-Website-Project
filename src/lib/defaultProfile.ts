/**
 * 회원가입 때 프로필 이미지를 올리지 않으면 저장하는 기본 이미지 (data URL).
 * 기존 서버는 scripts/default-profile.png를 파일로 읽었지만 Workers에는 파일 시스템이 없어
 * wrangler의 Data 규칙(wrangler.jsonc rules)으로 PNG를 코드에 함께 묶는다.
 */
import defaultProfilePng from '../assets/default-profile.png';
import { bytesToBase64 } from './encoding.ts';

/** 입력이 고정된 계산이라 isolate마다 한 번만 만든다. */
let cachedDataUrl: string | null = null;

export function getDefaultProfileDataUrl(): string {
  cachedDataUrl ??= `data:image/png;base64,${bytesToBase64(new Uint8Array(defaultProfilePng))}`;
  return cachedDataUrl;
}
