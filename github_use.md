# ckpt-prep-stack — GitHub 사용 가이드 & 세션 작업 기록

---

## 1. 이번 세션 작업 요약

### 1-1. NOTAM Package 1 분석 (`ImportantFile-2.pdf`)

**대상 비행편:** OZ224 / A388 (HL7634) / RKSI → KJFK | ETD 1205Z (29MAY26) → ETA 0108Z (30MAY26)

#### 룰 파일 (`NOTAM rule.rtf`) 적용 기준

| Rule | 내용 |
|------|------|
| 1 | A380 기종 관련 우선 / RUNUP PAD NOTAM 제외 / CODE F TWY 제한 제외 |
| 2 | 항로 관련 우선 / A220·320/321 ONLY 기종 제한 NOTAM 제외 |
| 3 | GPS RAIM Outage → ETD~ETA 시간대 해당 항목만 표시 / GPS 간섭은 전체 표시 |
| 4 | CRANE / OBST 정보 전체 제외 |
| 6 (KJFK) | Terminal 1만 유지 / TWY LGT·SIGN 제외 / OBST·CRANE·FLAGGED·MARKINGS 제외 / KENNEDY 5·SKORR 6 SID만 확인 |

#### DEP (RKSI) 핵심 NOTAM

- **⚠️ GPS**: RAIM Outage 29MAY 1248-1251Z, 1311-1333Z (NPA) / GPS 간섭경보 상시유효 (UFN)
- **🛫 RUNWAY**: SIPA 시범운용 (RWY 33R/34L, 15L/16R, ~10JUN26)
- **📡 NAVAID**: NCN/WNG VOR/DME 점검 일정 변경
- **💬 COMPANY**: 유사 콜사인 주의 (OZ335/OZ3355 등) / RUGMA → DCT OLMEN 권고

#### ARR (KJFK) 핵심 NOTAM (룰 적용 후)

- **🔴 APPROACH**: LGA VOR/DME U/S → KENNEDY 5 SID·ILS 절차 변경 (GPS 필수) / CMK VOR U/S → RWY 4L DME 필수 / RWY 22L PAPI·IM U/S
- **⚠️ RUNWAY**: RWY 31L TKOF HOLD LGT U/S 등
- **🚧 TAXIWAY**: TWY B·Z·KG·L·PB 폐쇄
- **🏢 TERMINAL 1**: T1 Ramp WIP 공사 / ARR Gate 5,7,8 → L1도어

#### ALTN (KPHL) 핵심 NOTAM → ENRTE NOTAM/ALTN 탭

- **🔴 APPROACH**: ILS RWY 26 완전 U/S / ILS RWY 27R GP U/S / RWY 09L ALS U/S / 다수 CAT II NA
- **⚠️ RUNWAY**: RWY 09R/27L 매일 0300-1100 폐쇄
- **🚧 TAXIWAY**: 다수 TWY 0200-1100 폐쇄

---

### 1-2. UI 변경사항 (`app.js`, `index.css`)

#### ACTIVE/INIT 페이지 하단 버튼 레이아웃 재구성

변경 전 → 변경 후 (2열 구조):

| Row | 왼쪽 (기존 유지) | 오른쪽 (신규) |
|-----|-----------------|--------------|
| 1 | MEL/CDL | **RTE SUMMARY** (최상단 이동) |
| 2 | DEP/ARR WX | **DEP/ARR NOTAM** |
| 3 | ENRTE WX | **ENRTE NOTAM** |
| 4 | FUEL&LOAD | (빈 버튼 — 추후 추가 예정) |
| 5 | STEP ALT | CREW/CABIN BRIEFING |

- 오른쪽 버튼 전체 디자인 통일 (130px, 흰 테두리, 동일 폰트)
- `cpny-to-aligned-btn` CSS 제거 → `btn-crew-briefing-trigger`로 교체

#### 신규 페이지 추가

**DEP/ARR NOTAM 페이지** (`renderDepArrNotamPage`)
- 탭: `DEP NOTAM` / `ARR NOTAM`
- 페이지 제목: `ACTIVE/DEP/ARR NOTAM`
- 상태 변수: `activeDepArrNotamTab`, `depArrNotamScrollIndex`

**ENRTE NOTAM 페이지** (`renderEnrteNotamPage`)
- 탭: `ALTN NOTAM` / `ERA NOTAM`
- 페이지 제목: `ACTIVE/ENRTE NOTAM`
- 상태 변수: `activeEnrteNotamTab`, `enrteNotamScrollIndex`

---

### 1-3. PDF 파싱 기능 추가 — NOTAM 자동 입력

#### 추가된 함수 목록

| 함수명 | 역할 |
|--------|------|
| `extractNotamPackage1(fullText)` | PDF 전체 텍스트에서 NOTAM PACKAGE 1 추출, [DEP]/[DEST]/[ALTN] 분리 |
| `parseNotamSection(text)` | 섹션 텍스트 → `{cat, id, dateEnd, sched, desc}` 배열 파싱 |
| `notamPassesRules(entry, airport, flightData)` | 룰 필터링 적용 (CRANE/LGT/SIGN/RAIM 등) |
| `notamRaimInWindow(entry, flightData)` | GPS RAIM Outage를 ETD-ETA 윈도우로 필터 |
| `buildNotamDisplayLines(entries, airport)` | 파싱 결과 → `{type, text}` 표시용 배열 변환 |
| `renderNotamRows(lines, scrollIndex)` | 13행 스크롤 테이블 HTML 생성 |
| `wrapText(text, maxLen)` | 긴 설명 텍스트 줄바꿈 처리 |

#### 데이터 흐름

```
IMPORT 버튼 (PDF)
  └─ pdfjsLib.getDocument() → fullText 추출
       └─ extractNotamPackage1(fullText)
            ├─ flightData.depNotamEntries[]   ← [DEP] 섹션
            ├─ flightData.arrNotamEntries[]   ← [DEST] 섹션
            └─ flightData.altnNotamEntries[]  ← [ALTN] 섹션

탭 열기 (DEP/ARR NOTAM)
  └─ getDepArrNotamTableHTML()
       └─ buildNotamDisplayLines(entries, airport)
            ├─ notamPassesRules() 필터링
            ├─ 카테고리별 그룹화 (◼ 헤더 기준)
            └─ renderNotamRows() → 13행 테이블

PDF 미임포트 시 → 하드코딩된 정적 데이터 표시 (fallback)
```

#### `flightData`에 추가된 필드

```javascript
flightData.depNotamEntries  = []  // RKSI NOTAM 파싱 결과
flightData.arrNotamEntries  = []  // KJFK NOTAM 파싱 결과
flightData.altnNotamEntries = []  // KPHL NOTAM 파싱 결과
```

---

## 2. GitHub 사용 가이드 (이 프로젝트 기준)

### 현재 브랜치 구조

```
main   ← 안정 버전 (production)
dev    ← 개발 브랜치 (현재 작업 중) ← HEAD
```

### 기본 워크플로우

```bash
# 1. 현재 상태 확인
git status
git log --oneline -10

# 2. 작업 내용 스테이징
git add app.js index.css          # 변경된 파일 명시적으로 추가
# git add -A 는 .env 등 민감한 파일 포함 가능 — 사용 주의

# 3. 커밋
git commit -m "Add NOTAM parsing and display for Package 1"

# 4. 원격 저장소 푸시
git push origin dev

# 5. main 으로 PR 생성 (GitHub CLI)
gh pr create --title "Add NOTAM Package 1 parsing" \
  --body "## Summary
- Add DEP/ARR NOTAM and ENRTE NOTAM pages
- Parse NOTAM PACKAGE 1 from imported PDF
- Apply rule-based filtering (CRANE/LGT/SIGN etc.)

## Test plan
- [ ] Import ImportantFile-2.pdf
- [ ] Verify DEP NOTAM tab shows RKSI entries
- [ ] Verify ARR NOTAM tab shows KJFK entries with rules applied
- [ ] Verify ALTN NOTAM tab shows KPHL entries"
```

### 브랜치 전략 권장

```bash
# 새 기능 개발 시
git checkout -b feature/notam-era-tab    # feature 브랜치 생성
# ... 작업 ...
git push origin feature/notam-era-tab
gh pr create --base dev                  # dev로 PR

# 핫픽스
git checkout -b hotfix/notam-scroll-bug
# ... 수정 ...
git push origin hotfix/notam-scroll-bug
gh pr create --base main                 # 긴급 시 main으로 직접 PR
```

### 자주 쓰는 명령어

```bash
# 변경사항 확인
git diff                          # unstaged 변경사항
git diff --staged                 # staged 변경사항

# 브랜치 관리
git branch -a                     # 전체 브랜치 목록
git checkout -b new-feature       # 새 브랜치 생성 & 이동
git merge dev                     # 현재 브랜치에 dev 병합

# 되돌리기 (주의)
git restore app.js                # 파일 변경사항 되돌리기 (unstaged)
git reset HEAD app.js             # 스테이징 취소
# git reset --hard 는 작업 내용 전체 삭제 — 신중하게 사용

# 원격 동기화
git fetch origin                  # 원격 변경사항 가져오기 (병합 안 함)
git pull origin dev               # fetch + merge

# GitHub CLI
gh pr list                        # PR 목록
gh pr status                      # 내 PR 상태
gh issue list                     # 이슈 목록
gh repo view --web                # 브라우저에서 저장소 열기
```

### 커밋 메시지 컨벤션

```
<type>: <subject>

feat:     새 기능 추가
fix:      버그 수정
refactor: 코드 구조 개선 (기능 변경 없음)
style:    CSS/UI 변경
docs:     문서 변경
chore:    빌드/설정 변경

예시:
feat: Add NOTAM Package 1 PDF parsing with rule filtering
fix: Fix DEP NOTAM scroll index not resetting on tab switch
style: Unify right-column button width to 130px
```

---

## 3. 프로젝트 구조 & 주요 참조

### 파일 구조

```
ckpt-prep-stack/
├── index.html          # PWA 진입점
├── app.js              # 전체 앱 로직 (단일 파일)
├── index.css           # 스타일
├── manifest.json       # PWA 매니페스트
├── sw.js               # Service Worker (오프라인 지원)
├── NOTAM rule.rtf      # NOTAM 브리핑 룰 (파일럿 지침)
├── github_use.md       # 이 문서
└── Test/
    └── ImportantFile-2.pdf   # 샘플 OFP (OZ224, 29MAY26)
```

### `app.js` 주요 섹션 위치 (대략적 라인)

| 섹션 | 내용 |
|------|------|
| L1~50 | `flightData` 초기값, 전역 상태 변수 |
| L53~ | `resetFlightData()` |
| L725~ | `extractWeatherSection()` — WX 파싱 |
| L768~ | NOTAM 파싱 함수 군 (`extractNotamPackage1` 등) |
| L860~ | MEL/CDL·Weather 상태 변수 및 정적 데이터 |
| L1060~ | `renderInitPage()` — ACTIVE/INIT 메인 페이지 |
| L1640~ | `renderDepArrWxPage()` — DEP/ARR WX |
| L1726~ | `renderDepArrNotamPage()` — DEP/ARR NOTAM |
| L1805~ | `renderEnrteNotamPage()` — ENRTE NOTAM |
| L1870~ | `renderEnrteWxPage()` — ENRTE WX |
| L2150~ | 전역 클릭 이벤트 핸들러 (`document.addEventListener`) |
| L3000~ | PDF import 파이프라인 (pdfjsLib) |

### 로컬 개발 서버 실행

```bash
cd /Users/flyingjet_mini/Documents/AI_CODING/GitHub/ckpt-prep-stack
python3 -m http.server 8765
# → http://localhost:8765 에서 확인
```

### 다음 작업 후보

- [ ] ERA NOTAM 탭 — NOTAM PACKAGE 2 ERA 섹션 파싱 연결
- [ ] 오른쪽 4번째 빈 버튼 기능 결정 및 구현
- [ ] NOTAM 파싱 정확도 개선 (복잡한 D) 스케줄 파싱)
- [ ] NOTAM 중요도 자동 분류 고도화
- [ ] dev → main PR 생성 및 병합

---

*최종 업데이트: 2026-06-15 (Claude Code 세션)*
