# ckpt-prep-stack — Claude Code 작업 인수인계

> 작성일: 2026-06-25 (최종 갱신: 2026-06-25 — SR 버그 수정 + 게이트 API 키 + 통합 테스트 완료)  
> 작성자: Claude (claude.ai 세션 → Claude Code 인수인계용)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 프로젝트명 | ckpt-prep-stack |
| 형태 | PWA (Progressive Web App) |
| 목적 | 아시아나항공 A380 기장의 비행 전 준비 자동화 |
| 호스팅 | GitHub Pages |
| 저장소 | github.com/flyingjet777/ckpt-prep-stack |
| 로컬 경로 | ~/Documents/AI_coding/github/ckpt-prep-stack |
| 브랜치 전략 | dev → 로컬 테스트 → main merge |
| 최신 커밋(dev) | 56207c4 (fix: SR 파싱 REFILE/END OF JEPPESEN 이후 구간 차단) |
| 사용자 | 조 기장 본인 + 다른 파일럿들도 사용 중 |

---

## 2. 현재 구현된 기능 (커밋 e70a111 기준)

### ① FIR NOTAM 탭
- OFP PACKAGE 3 파싱 함수: `extractNotamPackage3()`
- `[FIR]` 섹션별 분류: RKRR / RJJJ / KZAK / KZOA / KZLA
- AI 요약 함수: `callFirNotamAiSummary()`
  - Claude Sonnet 4.6 호출
  - 심각도 순 한국어 요약 출력
  - Anthropic API key는 localStorage 관리

### ② METAR 표시
- 소스: aviationweather.gov (API key 불필요)
- 캐시: 15분 (localStorage)
- 자동 갱신: OFP import 시 + WX 탭 진입 시
- 색상 배지: VFR(초록) / MVFR(파랑) / IFR(빨강) / LIFR(보라)

### ③ 게이트 조회
- API: AeroDataBox RapidAPI (FIDS endpoint)
- 요금: Tier 2, ~2 units/request, 무료 Basic 월 300회
- 표시 위치: INIT 페이지
- **✅ 완료** — `getOrAskAeroDataBoxKey()`로 localStorage에 키 저장, `fetchGate()`로 조회.
  실제 키로 동작 테스트 완료 (OZ202/AAR224 둘 다 ICAO/IATA 콜사인 모두 정상 응답,
  ETD 최근접 항편 선택 로직 정상)

---

## 3. OFP 파서 핵심 스펙

### 기본 규칙
- **PDF 최초 6페이지만 파싱** (Jeppesen Aviator OFP는 90페이지 이상)
- 아시아나 CFP 포맷 기준

### 파싱 대상 필드
| 필드 | 파싱 방법 |
|---|---|
| CRZ FL | `2ND-$` 이후 값 + 2,000ft 규칙 적용 |
| CI | 직접 추출 |
| APMS | 직접 추출 |
| ZFW CG | 직접 추출 |
| 연료 | 단위: Klbs |
| RAMP OUT | 직접 추출 |
| Wind/Temp | 항로 테이블에서 추출 |

---

## 4. ✅ SR 파싱 버그 — 수정 완료 (2026-06-25, 커밋 56207c4)

### 증상
```
AT FIR / 57N60  SR 06  TIME 04+14 / 04+48
AT ALUFF        SR 04  TIME 05+49
...
AT ENVOP        SR 05  TIME 00+14    ← 이상한 값 삽입
AT FIR / 57N60  SR 06  TIME 04+14   ← 전체 경로 중복 시작
...
```
전체 경로가 두 번 반복되고, REFILE 루트가 중간에 혼입됨.

### 원인 (3가지)

**버그 ①** — 6페이지 제한이 SR 파싱 함수에 미적용  
- OFP PDF 페이지 88-95에 메인 CFP 완전 복사본이 재수록됨
- 메인 OFP 파서는 6페이지 제한이 있지만 **SR 파싱 함수에는 동일 제한 없음**
- 결과: 복사본까지 읽어 전체 경로 2회 출력

**버그 ②** — REFILE 섹션 루트가 메인 루트에 혼입  
- OFP 구조:
  ```
  [페이지 2-5]  메인 루트 테이블 (KLAX→RKSI)
  [페이지 7-8]  REFILE 루트 (ADNAP→RJTT, ZT 00:00 기준 독립 테이블)
  ```
- 파서가 REFILE 구간(ADNAP→ALGES→ENVOP→...→RJTT)을 메인 루트에 이어 붙임
- `ENVOP SR05 TIME 00+14` 같은 이상한 값이 혼입되는 원인

**버그 ③** — 시간 역순 발생 (KAMSA 11+33 → ADNAP 10+08)  
- REFILE 섹션의 ADNAP이 메인 루트 ADNAP과 혼동
- SR 그룹핑 로직이 시간 순서를 역행하는 묶음 생성

### 적용된 수정 (app.js:4308 근처, 메인 루트/터뷸런스 SR 파싱 루프)

```javascript
const lines = fullText.split('\n');
for (let i = 0; i < lines.length; i++) {
    const lineStr = lines[i].trim();
    // REFILE 섹션/문서 끝 이후로는 메인 루트가 아니므로 중단
    if (
        lineStr.includes('REFILE FLT PLAN') ||
        lineStr.includes('END OF JEPPESEN') ||
        lineStr.includes('ROUTE TO ALTN')
    ) {
        break;
    }
    // ... 기존 파싱 로직
}
```

> 참고: 실제 코드에는 6페이지 제한 자체가 없고 PDF 전체 페이지를 `fullText`로
> 합쳐서 순차 처리하는 구조였음. `ROUTE TO ALTN`이 메인 루트 테이블 종료 직후
> (목적지 도착 직후) 정확히 나타나는 마커라서, 이 지점에서 break하면 REFILE
> 섹션과 후반부(88p~) CFP 복사본이 자연스럽게 모두 차단됨.

### 검증 결과 (Test/ImportantFile-6.pdf, AAR224 RKSI/KJFK, 112페이지)
- 수정 전: 134개 웨이포인트 (경로 2회 중복)
- 수정 후: 67개 웨이포인트 (EGOBA → ... → VADDR, 1회만 정상 추출)

---

## 5. 작업 완료 현황 (2026-06-25)

| 순위 | 작업 | 상태 |
|---|---|---|
| 1 | **SR 버그 수정** | ✅ 완료 — 커밋 56207c4 |
| 2 | **AeroDataBox RapidAPI 키 설정** | ✅ 완료 — 코드 자체는 기존에 구현되어 있었음(localStorage 기반 prompt), 실키로 동작 검증 완료 |
| 3 | **실제 OFP 전체 기능 테스트** | ✅ 완료 — METAR(RKSI/KJFK/KBOS), 게이트(AAR224), FIR NOTAM PACKAGE 3(11개 FIR: RKRR/RJJJ/PAZA/CZVR/CZEG/CZWG/KZMP/CZYZ/KZOB/KZBW/KZNY) 전부 실데이터로 검증 |

### 다음 세션 참고
- FIR NOTAM AI 요약([app.js:1014](app.js:1014))이 PACKAGE 3 원문 전체(이 테스트 PDF 기준 약 5.9만자)를
  통째로 Claude API에 보내는 구조 — 토큰 비용 최적화 여지 있음 (우선순위 낮음, 필요 시 검토)

---

## 6. API 및 인프라

| 항목 | 내용 |
|---|---|
| Anthropic API | Pay-per-token (Pro 구독과 별도), ~$0.01-0.02/비행 |
| 모델 | claude-sonnet-4-6 |
| API Key 관리 | localStorage (앱 내 설정 화면) |
| AeroDataBox | RapidAPI, Basic 무료 플랜 |
| aviationweather.gov | 무료, API key 불필요 |
| VPS | IONOS 74.208.16.254 (Ubuntu 24.04) — 별도 프로젝트, ckpt-prep-stack과 무관 |

---

## 7. 코딩 환경

| 항목 | 내용 |
|---|---|
| 주 개발 머신 | MacBook Pro M1 Pro 16GB |
| 터미널 | Warp |
| Claude Code | Pro 플랜 (flyingjet@mac.com) |
| 로컬 경로 | ~/Documents/AI_coding/github/ckpt-prep-stack |
| 보조 도구 | opencode v1.14.31 (Xiaomi MiMo API) |

---

## 8. OFP 포맷 참고 — 섹션 구조

```
[페이지 1]     표지
[페이지 2-5]   메인 CFP (연료, 루트 테이블, 서명란)  ← 파싱 대상
[페이지 5]     FPL 복사본
[페이지 6]     Wind/Temp Summary
[페이지 7-8]   REFILE FLT PLAN (ADNAP→RJTT)         ← break 필요
[페이지 8]     END OF JEPPESEN DATAPLAN              ← break 필요
[페이지 9-10]  ATS FPL 사본
[페이지 11]    VAG 화산재 차트
[페이지 12-17] Dispatch Release, Weather Briefing
[페이지 18-24] 기상 차트 (Wind/Temp, SigWx, ASC, Cross Section)
[페이지 25-34] NOTAM Package 1
[페이지 35-63] NOTAM Package 2
[페이지 64-86] NOTAM Package 3                      ← FIR NOTAM 파싱 대상
[페이지 87]    OFP 주요 변경사항 안내
[페이지 88-96] 메인 CFP 완전 복사본                  ← 6페이지 제한으로 차단
[페이지 97-98] TDM Track 정보
```

---

## 9. 작업 시 주의사항

- 아시아나항공은 **중동 노선 운항하지 않음** — 관련 내용 추가 금지
- NOTAM 브리핑 기준: **Code F (A380) 해당 항목만** 필터링
- 예비공항 기준: 활주로 폭 **60m(197ft) 이상** + 길이 적합
- ETO와 NOTAM 유효시간 **교차검증** 후 실제 영향 있는 항목만 정리

---

*이 파일을 Claude Code 세션 시작 시 먼저 읽으면 컨텍스트 파악 완료*
