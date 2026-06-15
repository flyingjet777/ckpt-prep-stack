# NOTAM 표시 규칙 (NOTAM_CODE.md)

> 이 파일은 `app.js`의 `notamPassesRules()`, `buildNotamDisplayLines()`, `summarizeNotam()` 함수에 적용된 NOTAM 필터링·표시 규칙을 정리한 문서입니다.  
> 수정 시 이 파일과 코드를 함께 업데이트하세요.

---

## 1. 공통 표시 규칙 (모든 공항)

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 1-1 | A380 기종과 관련된 항목을 우선 표시 | 카테고리 우선순위 정렬 (§7 참조) |
| 1-2 | 활주로(RWY) 규격 정보는 최상단에 표시. 1줄에 활주로 1개씩 | `extractRunwayInfo()` → `buildNotamDisplayLines()` 상단 |
| 1-3 | 스크롤 버튼은 1페이지(13행) 단위로 이동. 길게 누르면 연속 이동 | 클릭 핸들러 + `pointerdown` hold 로직 |
| 1-4 | 모든 NOTAM 내용의 약어는 대문자 유지 (`desc.toUpperCase()`) | `summarizeNotam(desc)` 함수 |
| 1-5 | NOTAM 표시 형식: 1행에 NOTAM 번호(밑줄) + 날짜범위, 2행~에 내용 | `buildNotamDisplayLines()` |
| 1-6 | 각 NOTAM 항목 사이에 1줄 여백 | `lines.push({ type: 'blank' })` |
| 1-7 | TAXIWAY: CODE F 날개폭 제한 항목 제외 (`CODE F` / `WINGSPAN MORE THAN` / `WING SPAN MORE THAN`) | `notamPassesRules()` — 구현됨 |
| 1-14 | TAXIWAY: `LGT`, `LIGHT`, `SIGN`, `MARKING`, `BARRICADED`, `DIMMED` 포함 항목 전역 제외 | `notamPassesRules()` — 구현됨 |
| 1-8 | RUNUP PAD 관련 NOTAM 제외 (A380 사용 불가) | `notamPassesRules()` |
| 1-9 | 모든 공항의 DEP(출발) 및 IAP(계기접근) 관련 NOTAM은 반드시 표시 | `isApproach \|\| isDeparture → return true` |
| 1-10 | DEP 관련 항목과 APPROACH 관련 항목을 시각적으로 분리 (빈 줄) | `buildNotamDisplayLines()` 카테고리 그룹 구분선 |
| 1-11 | OTHER / TAXIWAY LIGHT 카테고리는 CLSD 또는 WIP 포함 항목만 표시 | `notamPassesRules()` |
| 1-12 | 기종 제한 NOTAM 제외 (`A220 ONLY`, `320/321 ONLY`) | `notamPassesRules()` |
| 1-13 | CRANE / OBST / FLAGGED 포함 항목 전역 제외 | `notamPassesRules()` |

---

## 2. 게이트/스탠드 용어 통일 원칙

> NOTAM에서 게이트/주기장을 지칭하는 용어는 공항·항공사마다 다르게 사용되지만 모두 동일한 개념으로 취급한다.

| 용어 | 예시 표현 |
|------|-----------|
| `GATE` | GATE 266, GATE 45 |
| `STAND` | STAND NR 312, STAND 711 |
| `SPOT` | SPOT 43, SPOT 42 |
| `BAY` | BAY 12, BAY A3 |
| `REMOTE` | REMOTE 5 |

위 5개 키워드 뒤에 번호가 명시된 NOTAM에만 §4의 공항별 필터링 규칙을 적용한다.  
번호가 언급되지 않은 NOTAM은 필터 대상이 아니며 다른 규칙으로 판단한다.

---

## 3. GPS RAIM 규칙

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 3-1 | GPS RAIM OUTAGE는 ETD~ETA 시간대와 겹치는 경우에만 표시 | `notamRaimInWindow(entry, flightData)` |
| 3-2 | GPS SIGNAL UNRELIABLE / INTERFERENCE는 시간 무관하게 항상 표시 | `cat === 'GPS'` 이고 RAIM이 아닌 경우 pass |
| 3-3 | RAIM 다중 시간창(D 스케줄)은 날짜 배지에 넣지 않고 일자별로 줄을 나눠 표시 (`06  1116-1119  1215-1217`) | `buildNotamDisplayLines()` — `isRaimSched` 분기 |

---

## 4. 공항별 게이트 필터링

### RKSI (인천국제공항)
- **266, 267, 268번만 표시**, 다른 번호가 명시된 항목은 제외

### KLAX (로스앤젤레스국제공항)
- **148, 150, 152, 154, 156번만 표시**, 다른 번호가 명시된 항목은 제외

### RJAA (나리타국제공항)
- **45, 46번만 표시**, 다른 번호가 명시된 항목은 제외

### RCTP (타오위안국제공항)
- **C1~C6, D1~D6만 표시**, 다른 번호가 명시된 항목은 제외

### VTBS (수완나품국제공항)
- **S111~S118만 표시**, 다른 번호가 명시된 항목은 제외

### KJFK (존 F. 케네디 국제공항)
- **5, 7, 8번만 표시** (Terminal 1 게이트), 다른 번호가 명시된 항목은 제외
- 추가 제외: `LGTD AND BARRICADED`, `MARKINGS`, TWY 중 LGT/SIGN만 언급되고 CLSD·WIP 없는 항목, `TERMINAL 2~9` / `T2~T9 RAMP`
- 반드시 표시: KENNEDY 5 / SKORR 6 SID, 모든 IAP

---

## 5. 카테고리 표시 순서

NOTAM Package 1 PDF에 나타나는 `◼` bullet 순서를 그대로 따른다.  
별도 정렬 없음 — `catOrder` 배열에 첫 등장 순으로 추가되며 그 순서로 표시.

> 카테고리 인식 실패 시(bullet 인코딩 차이 등) keyword reclassification으로 자동 보정 (§6 참조)

---

## 6. 구현 현황

- [x] 카테고리 우선순위 정렬
- [x] RWY 규격 정보 최상단 표시
- [x] NOTAM 표시 형식 — 1행: ID + 날짜범위 / 2행~: 내용 (대문자, 74자 wrap)
- [x] CODE F TWY 항목 필터링
- [x] RUNUP PAD 제외
- [x] OTHER / TAXIWAY LIGHT — CLSD·WIP 없는 항목 제외
- [x] 기종 제한 NOTAM 제외 (A220, 320/321)
- [x] CRANE / OBST / FLAGGED 전역 제외
- [x] GPS RAIM — ETD~ETA 윈도우 필터
- [x] RKSI 게이트 필터 (266, 267, 268) — GATE/STAND/SPOT/BAY/REMOTE 모두 적용
- [x] KLAX 게이트 필터 (148, 150, 152, 154, 156) — GATE/STAND/SPOT/BAY/REMOTE 모두 적용
- [x] RJAA 게이트 필터 (45, 46) — GATE/STAND/SPOT/BAY/REMOTE 모두 적용
- [x] RCTP 게이트 필터 (C1-C6, D1-D6) — GATE/STAND/SPOT/BAY/REMOTE 모두 적용
- [x] VTBS 게이트 필터 (S111-S118) — GATE/STAND/SPOT/BAY/REMOTE 모두 적용
- [x] KJFK 게이트 필터 (5, 7, 8) + 추가 필터
- [x] `summarizeNotam()` — 전체 대문자 유지 (`desc.toUpperCase()`)
- [x] EDTO NOTAM 탭 — NOTAM PACKAGE 2 [ETP] 섹션 파싱 연결 (`extractNotamPackage2()`)
- [ ] FIR NOTAM 탭 — NOTAM PACKAGE 3 파싱 연결

---

## 7. EDTO NOTAM (PACKAGE 2 ETP 섹션)

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 7-1 | NOTAM PACKAGE 2 전체 블록을 먼저 추출 | `extractNotamPackage2()` |
| 7-2 | `[ETP] ICAO / IATA / 공항 전체 이름` 형식의 제목줄로 섹션을 분리 | `etpRe = /(\[ETP\][^\n]*)\n([\s\S]*?)(?=\[ETP\]|$)/gi` |
| 7-3 | OFP 상단 "ETP :" 열에 나열된 공항과 동일한 공항이 `[ETP]` 섹션으로 등장 | 동일 정규식으로 처리됨 |
| 7-4 | 각 ETP 공항 제목을 **✈️  [ETP] ICAO / IATA / 공항명** 형태로 큰 글씨(cyan, bold)로 표시 | `buildEtpNotamDisplayLines()` — `type: 'etp-title'` |
| 7-5 | 제목 이하 NOTAM은 기존 `buildNotamDisplayLines()` 규칙(필터링 포함)을 그대로 적용 | `buildEtpNotamDisplayLines()` 내부에서 호출 |
| 7-6 | EDTO NOTAM 탭 헤더에 ETP 공항 코드 목록을 표시 (예: RJCC / PANC / PACD) | `renderEnrteNotamPage()` |
