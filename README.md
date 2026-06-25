<div align="center">

# ✈️ ckpt-prep-stack

### A380 FMS Multi-Function Display — Cockpit Preparation Stack

**아시아나항공 A380 기장의 비행 전 준비를 자동화하는 PWA**

OFP(Operational Flight Plan) PDF 한 장을 import하면 초기화 데이터·연료·루트·NOTAM·기상을 자동으로 파싱하고 교차검증합니다.

<br>

![Platform](https://img.shields.io/badge/platform-PWA%20(iPad%20optimized)-0b7285?style=flat-square)
![Stack](https://img.shields.io/badge/stack-Vanilla%20JS%20%2F%20HTML%20%2F%20CSS-f59f00?style=flat-square)
![Hosting](https://img.shields.io/badge/hosting-GitHub%20Pages-24292e?style=flat-square)
![Status](https://img.shields.io/badge/status-실사용%20중-2f9e44?style=flat-square)

*Designed by and for A380 pilots — 실제 운항 현장에서 사용됩니다.*

</div>

---

## 📖 개요

ckpt-prep-stack은 Jeppesen Aviator OFP(90+ 페이지 PDF)를 브라우저에서 직접 읽어, A380 운항에 필요한 핵심 정보만 추려 **FMS/MFD 스타일 화면**으로 보여주는 경량 웹앱입니다. 빌드 도구·서버 프레임워크 없이 순수 HTML/CSS/JS로 동작하며, iPad 홈 화면에 추가해 오프라인 PWA로 쓸 수 있습니다.

외부 데이터(METAR·게이트·NOTAM AI 요약)는 조종사가 API 키를 입력할 필요 없이 **공용 프록시 서버**를 통해 투명하게 제공됩니다.

---

## 🚀 주요 기능

### 📄 OFP 스마트 파서
- PDF에서 **FLT NBR · ACFT REG · FROM/TO/ALTN · CRZ FL/TEMP · CI · APMS · ZFW/CG · 연료 · TROPO · TRIP WIND**를 자동 추출·하이라이트
- **PRIMARY 루트** 및 **STEP ALT** 파싱
- **SR(Shear Rate) 터뷸런스 존**을 시간순으로 그룹핑 (LGT→MOD 녹색 / MOD→SVR 적색)
  - REFILE/문서 끝 마커에서 파싱을 중단해 경로 중복·혼입 방지

### 🗺️ RTE SUMMARY — PRIMARY / ALTERNATE RTEs
- **PRIMARY RTEs**: 주 항로 + OFP 내 두 개의 `(FPL-편명-I…)` 블록을 비교해 **"OFP와 ATS PLAN 일치"** 여부 자동 검증
- **ALTERNATE RTEs**: DEST→ALTN 경로(`ROUTE TO ALTN`), **LOLV Equal Time Point**(구간·위경도, 10진 표기), **3% Contingency ERA Validation**, **REFILE FLT PLAN**(구간별 RQRD 연료 + RIF 루트) 통합 표시
- 두 탭 모두 13행 고정 + ▼▼/▲▲ 페이지네이션으로 일관된 레이아웃

### 🌦️ 기상 브리핑 (MET)
- DEP / ARR / ALTN / ENROUTE TAF 표시, **ETD/ETA에 가장 근접한 시간대 블록을 녹색 하이라이트**
- **METAR** 실시간 조회 (VFR/MVFR/IFR/LIFR 색상 배지)
- ERA WX는 주요 ETOPS/교체 공항(PHNL 포함)을 필터링

### 🛂 게이트 조회
- 편명·날짜 기반으로 출발 게이트/터미널 자동 조회 (AeroDataBox)

### 📋 NOTAM
- OFP NOTAM PACKAGE 1/2/3 파싱, FIR별 분류 및 AI 요약(Claude)
- *현재 고도화 작업 중 — 각 NOTAM 페이지에 "OFP NOTAM PACKAGE 참고" 안내 표시*

### ⛽ FUEL & LOAD
- PAX NBR을 **비즈니스/이코노미/총원**으로 분리 표시
- **CGO(T)**: 화물 LBS → 톤 자동 환산
- DISPATCH NOTES + **ROUTE FUEL CONSUMPTION STATISTICS** (MEAN/95%/99%, 부호 포함)

### 📝 MEMO
- **NOTEPAD**: 멀티페이지 텍스트 메모
- **DRAWPAD**: 캔버스 자유 필기(색상·펜 굵기·지우개), 멀티페이지
- 기기별 localStorage 저장

---

## 🏗️ 아키텍처

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  PWA (GitHub Pages)          │         │  VPS (IONOS, Docker)               │
│  flyingjet777.github.io      │  HTTPS  │  airbus380cbt.com/ckpt-proxy/      │
│                              │ ──────► │                                    │
│  • app.js (파싱/렌더링)       │         │  ckpt-proxy (Express)              │
│  • pdf.js (클라이언트 파싱)    │         │   ├─ /metar   → aviationweather    │
│  • localStorage (메모)        │         │   ├─ /gate    → AeroDataBox        │
│                              │         │   └─ /notam-summary → Anthropic    │
└─────────────────────────────┘         │  비밀 키는 서버 .env 에만 존재         │
                                         └──────────────────────────────────┘
```

- **클라이언트는 API 키를 절대 보유하지 않습니다.** 모든 외부 호출은 프록시를 경유하며, 키는 VPS의 `.env`에만 저장됩니다.
- `aviationweather.gov`는 브라우저 CORS를 막아두어, 프록시(서버-서버 호출)로 우회합니다.

---

## 🛠️ 사용법

1. 브라우저에서 페이지를 열거나 iPad 홈 화면에 추가 ("홈 화면에 추가")
2. `ACTIVE/INIT` 화면 우측 상단 **IMPORT**로 OFP PDF 업로드
3. 자동 파싱된 값 확인 — OFP 기준과 일치하면 녹색 하이라이트
4. `RTE SUMMARY` · `DEP/ARR WX` · `STEP ALT` · `FUEL&LOAD` 등에서 교차검증

---

## 💻 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프런트엔드 | 순수 HTML5 / CSS3 / Vanilla JavaScript (빌드 없음) |
| PDF 파싱 | PDF.js (클라이언트 사이드) |
| 프록시 | Node.js · Express · Docker (VPS) |
| 외부 데이터 | aviationweather.gov(METAR) · AeroDataBox(게이트) · Anthropic Claude(NOTAM 요약) |
| 폰트 | Share Tech Mono · Courier Prime (CRT 디스플레이 룩) |
| 호스팅 | GitHub Pages (PWA) |

---

## 📁 저장소 구조

```
ckpt-prep-stack/
├── index.html          # 진입점 / 상단 네비게이션
├── index.css           # FMS/MFD 스타일
├── app.js              # 전체 로직 (파싱·필터링·렌더링)
├── sw.js, manifest.json# PWA 오프라인 지원
├── proxy/              # 공용 프록시 서버 소스 (Express + Docker)
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
└── NOTAM_CODE.md       # NOTAM 필터링/표시 규칙 문서
```

---

## 🌿 브랜치 운영

`dev`에서 개발·검증 → `main` 머지 시 GitHub Pages로 운영 배포. `main`은 실사용 브랜치이므로 검증 완료된 변경만 반영합니다.

---

<div align="center">
<sub>이 도구는 보조 자료입니다. 1차 정보원은 Jeppesen Aviator 공식 OFP·브리핑입니다.</sub>
</div>
