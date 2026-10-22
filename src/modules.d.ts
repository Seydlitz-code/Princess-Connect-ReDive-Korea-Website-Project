/** wrangler의 Data 규칙으로 묶는 파일은 ArrayBuffer로 들어온다 (wrangler.jsonc rules). */
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}
