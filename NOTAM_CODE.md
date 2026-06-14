# NOTAM 표시 규칙 (NOTAM_CODE.md)

> 이 파일은 `app.js`의 `notamPassesRules()`, `buildNotamDisplayLines()`, `summarizeNotam()` 함수에 적용된 NOTAM 필터링·표시 규칙을 정리한 문서입니다.  
> 수정 시 이 파일과 코드를 함께 업데이트하세요.

---

## 1. 공통 표시 규칙 (모든 공항)

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 1-1 | A380 기종과 관련된 항목을 우선 표시 | 카테고리 우선순위 정렬 (APPROACH → RUNWAY → ...) |
| 1-2 | 활주로(RWY) 규격 정보는 최상단에 표시. 1줄에 활주로 1개씩 | `extractRunwayInfo()` → `buildNotamDisplayLines()` 상단 |
| 1-3 | 스크롤 버튼은 1페이지(13행) 단위로 이동. 길게 누르면 연속 이동 | 클릭 핸들러 + `pointerdown` hold 로직 |
| 1-4 | 모든 NOTAM 내용은 약어를 풀어서 이해하기 쉽게 표시 | `summarizeNotam(desc)` 함수 |
| 1-5 | 모든 NOTAM 앞에 NOTAM 번호를 밑줄과 함께 표시 | `<u>${e.id}</u>` |
| 1-6 | 각 NOTAM 항목 사이에 1줄 여백 | `lines.push({ type: 'blank' })` |
| 1-7 | CODE F 항공기(날개폭 79.25m 이상) 제한 TWY 관련 항목은 제외 (단, 일반 TWY 제한은 표시) | *(미구현 — CODE F TWY 식별 패턴 필요)* |
| 1-8 | RUNUP PAD 관련 NOTAM 제외 (A380 사용 불가) | `notamPassesRules()` |
| 1-9 | 모든 공항의 DEP(출발) 및 IAP(계기접근) 관련 NOTAM은 반드시 표시 | `isApproach \|\| isDeparture → return true` |
| 1-10 | DEP 관련 항목과 APPROACH 관련 항목을 시각적으로 분리 (빈 줄) | `buildNotamDisplayLines()` 카테고리 그룹 구분선 |
| 1-11 | CLSD 항목은 날짜/시간 범위와 스케줄(D) 정보를 함께 표시 | `showDate && isClsd` 분기 처리 |

---

## 2. 항로(ENRTE) 관련 규칙

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 2-1 | 해당 비행편의 항로와 관련된 내용을 우선 표시 | *(ERA NOTAM 탭 — 미구현)* |
| 2-2 | 기종 제한 NOTAM 제외 (예: A220 ONLY, 320/321 ONLY) | `notamPassesRules()` |

---

## 3. GPS RAIM 규칙

| # | 규칙 | 구현 위치 |
|---|------|-----------|
| 3-1 | GPS RAIM OUTAGE는 ETD~ETA 시간대와 겹치는 경우에만 표시 | `notamRaimInWindow(entry, flightData)` |
| 3-2 | GPS SIGNAL UNRELIABLE / INTERFERENCE는 시간 무관하게 항상 표시 | `cat === 'GPS'` 이고 RAIM이 아닌 경우 pass |

---

## 4. 공항별 게이트/스탠드 필터링

### RKSI (인천국제공항)
- **266, 267, 268번 게이트에 대한 NOTAM만 표시**
- 다른 게이트/스탠드 번호가 명시된 NOTAM은 모두 제외
- 게이트 번호가 언급되지 않은 NOTAM은 제외 대상이 아님 (다른 규칙으로 판단)

### KLAX (로스앤젤레스국제공항)
- **148, 150, 152, 154, 156번 게이트를 제외한 나머지 게이트 NOTAM 제외**
- *(미구현 — 코드 추가 필요)*

### RJAA (나리타국제공항)
- **45, 46번 게이트를 제외한 나머지 게이트 NOTAM 제외**
- *(미구현 — 코드 추가 필요)*

### RCTP (타오위안국제공항)
- **C1~C6, D1~D6번 게이트를 제외한 나머지 게이트 NOTAM 제외**
- *(미구현 — 코드 추가 필요)*

### VTBS (수완나품국제공항)
- **S111~S118번 게이트를 제외한 나머지 게이트 NOTAM 제외**
- *(미구현 — 코드 추가 필요)*

---

## 5. 전역 제외 항목

| 제외 대상 | 이유 | 구현 |
|-----------|------|------|
| `A220 ONLY`, `320/321 ONLY` | 기종 부적합 | `notamPassesRules()` |
| `RUNUP PAD` | A380 사용 불가 | `notamPassesRules()` |
| `CRANE`, `OBST`, `FLAGGED` | 장애물 정보 — 운항 직접 관련 없음 | `notamPassesRules()` |
| `OTHER` / `TAXIWAY LIGHT` 카테고리 중 CLSD·WIP 아닌 항목 | 조명 고장 등 경미한 정보 | `notamPassesRules()` |

---

## 6. KJFK (존 F. 케네디 국제공항) 추가 필터

| 제외 대상 | 이유 |
|-----------|------|
| `LGTD AND BARRICADED` | 일반 공사 구간 — 항공기 경로와 무관 |
| `MARKINGS` | 표시 관련 경미한 정보 |
| TWY 항목 중 `LGT` 또는 `SIGN`만 언급되고 CLSD·WIP 없는 경우 | 경미한 조명/표지판 정보 |
| RAMP/RUNWAY LIGHT 항목 중 `TERMINAL 2~9`, `T2~T9 RAMP` | Terminal 1(A380 사용 터미널) 외 정보 |
| 5번, 7번, 8번 게이트를 제외한 나머지 게이트 NOTAM | Terminal 1 게이트만 관련 있음 |

**반드시 표시:**
- KENNEDY 5, SKORR 6 SID 관련 NOTAM
- 모든 IAP (계기접근) 관련 NOTAM

---

## 7. 카테고리 표시 우선순위

```
0  APPROACH
1  APPROACH LIGHT
2  RUNWAY
3  RUNWAY LIGHT
4  DEPARTURE
5  TAXIWAY
6  TAXIWAY LIGHT
7  NAVAID
8  GPS
9  RAMP
10 AIRPORT
11 COMPANY ADVISORY
12 OBSTRUCTION
13 OTHER
```

---

## 8. 구현 현황

- [x] RKSI 게이트 필터 (266, 267, 268)
- [x] KLAX 게이트 필터 (148, 150, 152, 154, 156)
- [x] RJAA 게이트 필터 (45, 46)
- [x] RCTP 게이트 필터 (C1-C6, D1-D6)
- [x] VTBS 게이트 필터 (S111-S118)
- [x] KJFK 게이트 5, 7, 8 필터
- [x] CODE F TWY 제한 항목 필터링 (`CODE F` / `WINGSPAN MORE THAN` 포함 TAXIWAY NOTAM 제외)
- [ ] `summarizeNotam()` 확장 — 더 많은 약어 패턴 추가
- [ ] ERA NOTAM 탭 — NOTAM PACKAGE 2 파싱 연결
