# 업데이트 내역

## Ver 0.4.6.37 — 2026-06-09

### 텍틱 기록기 (Tactic Table Editor)

#### 버그 수정
- **캐릭터명 자동 삽입 시 표 경계선 소실 문제 해결**
  - 근본 원인: `contentEditable="false"`인 `<td>`에 `textContent`를 직접 설정할 때 Chromium contentEditable 엔진이 테이블 DOM 정규화(normalization)를 수행하여 `border-collapse` 환경에서 인접 셀 경계선이 사라지는 현상
  - 수정: `<td>` 내부에 항상 `<span class="clan-tactic-table__char-name-text">` 자식을 유지하고, `textContent`는 `<span>`에만 적용하도록 변경 (`public/js/main.js`)
  - placeholder CSS: `.clan-tactic-table__char-name-text:empty::before` 규칙 추가 (`public/css/main.css`)

- **데미지 입력 구역 확장으로 인한 이미지 셀 비정상적 세로 확장 문제 해결**
  - 근본 원인: `damage-input`의 `min-height: 160px`가 `rowSpan=4`와 결합되어 tr1 행 전체가 160px로 확장, 보스 이미지 및 캐릭터 이미지 셀이 비정상적으로 길어짐
  - 수정:
    - `dmgCell`의 `rowSpan=4` 제거, tr2-tr4에 `colSpan=2` placeholder 셀(`clan-tactic-table__main-cell--placeholder`) 추가
    - `main-cell` height를 `var(--tactic-image-slot-size)` (82.5px)로 축소
    - `damage-input`의 `min-height: 160px` 제거 (`public/js/main.js`, `public/css/main.css`)

- **bossname-input 오버플로우 수정**
  - `box-sizing: border-box` 추가 (`public/css/main.css`)

#### 기능 개선
- **"+ 텍틱 추가" 버튼 동작 변경**
  - 기존: 새 텍틱 표 전체를 생성하여 아래에 추가
  - 변경: 버튼 행 바로 위에 새 텍틱 입력 행(`: | 텍틱 입력 | 오토여부 ×5`)을 삽입
  - `createTacticInputRow()` 함수 분리 (`public/js/main.js`)
  - 추가 버튼 셀 `colSpan` 7 → 8로 확장 (col-narrow 열 포함)

- **텍스트 정렬 및 여백 조정**
  - `tactic-text-cell`: `text-align: left` + `padding: 6px 12px` (텍스트 입력 시작 위치를 경계선에서 분리)
  - `auto-cell`: `padding: 4px 8px` (placeholder가 경계선에 붙지 않도록)
  - `rank-input`: `padding: 2px 6px`
  - `char-name-cell`: `padding: 4px 8px`

- **데미지 입력 폰트 크기 2배 증가**
  - `damage-input`: `font-size: 1rem` → `2rem`
  - placeholder도 동일 크기로 통일 (`public/css/main.css`)

### 변경 파일
- `public/js/main.js` — `createTacticInputRow()`, `createTacticTableElement()`, `tacticCharPopupConfirm` handler, delete handler
- `public/css/main.css` — `.clan-tactic-table__main-cell`, `--placeholder`, `__tactic-text-cell`, `__auto-cell`, `__rank-input`, `__char-name-cell`, `__char-name-text`, `__damage-input`
