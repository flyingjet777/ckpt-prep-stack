# CRZ WIND 데이터 기능

## 개요

OFP PDF의 `START OF WIND AND TEMPERATURE SUMMARY` 구간에서 FL330, FL350, FL370, FL390의 WIND/SAT 데이터를 읽어 CRZ WIND 페이지에 표시한다.

표시 형식은 다음과 같다.

```text
250/087 -55
```

앞의 값은 풍향/풍속이며, 뒤의 값은 SAT(°C)이다. CMP 값은 화면 표시에서 제외한다.

## PDF IMPORT 처리

- PDF를 IMPORT할 때마다 현재 OFP의 WIND SUMMARY를 새로 파싱한다.
- 새 IMPORT 전에 이전 WIND DATA와 스크롤 위치를 초기화한다.
- PDF의 노선명이 달라도 제목의 고정 부분인 `START OF WIND AND TEMPERATURE SUMMARY`를 기준으로 구간을 찾는다.
- OFP 표 구조에 따라 FL 데이터 행 다음에 나오는 waypoint 행에 데이터를 연결한다.
- 3~5글자 waypoint와 좌표형 waypoint를 모두 인식한다.
- CMP 구분자가 `+` 또는 `-`인 OFP 형식을 모두 처리한다.
- PDF 후반에 dataplan이 반복되는 경우 waypoint 중복을 제거한다.

## 좌표 waypoint 정규화

STEP ALT와 CRZ WIND의 좌표 표기가 달라도 동일 좌표로 비교한다.

| 전체 표기 | 축약 표기 |
|---|---|
| `65N160W` | `65N60` |
| `37N170E` | `37E70` |
| `37N180E` | `37E80` |

### ARINC 424 WGS84 사분면 참조

문자 위치는 위도 반구와 경도 방향, 그리고 경도 100도 기준으로 결정한다.

| 좌표 | ARINC 424 축약형 |
|---|---|
| 50N040W | `5040N` |
| 30N160W | `30N60` |
| 50N020E | `5020E` |
| 50N120E | `50E20` |
| 52S075W | `5275W` |
| 52S160W | `52W20` *(원문 예시, 계산 규칙과 불일치 가능성 확인 필요)* |
| 60S030E | `6030S` |
| 60S130E | `60S30` |

코드의 정규화 함수는 다음 사분면 규칙을 사용한다.

- N/W 100도 미만: `위도 + 경도 + N`
- N/W 100도 이상: `위도 + N + (경도-100)`
- N/E 100도 미만: `위도 + 경도 + E`
- N/E 100도 이상: `위도 + E + (경도-100)`
- S/W 100도 미만: `위도 + 경도 + W`
- S/W 100도 이상: `위도 + W + (경도-100)`
- S/E 100도 미만: `위도 + 경도 + S`
- S/E 100도 이상: `위도 + S + (경도-100)`

## 화면 표시

- CRZ WIND 페이지에는 한 번에 10개 waypoint를 표시한다.
- `▲▲`, `▼▼` 버튼으로 10개 단위 스크롤한다.
- WIND/SAT 하단에는 IMPORT한 OFP의 출발지/도착지를 표시한다.
- waypoint 사이에는 옅은 회색 구분선을 표시한다.
- `STEP ALT` 탭과 `CRZ WIND` 탭을 서로 이동할 수 있다.
- RETURN 및 위/아래 스크롤 버튼을 유지한다.

## 색상 규칙

### 시안색 / 흰색 비교

각 고도별로 waypoint를 순서대로 비교한다.

- 첫 번째 유효 데이터가 해당 항목의 기준값이 된다.
- 방향 차이가 30° 이상이면 시안색이다.
- 풍속 차이가 30kt 이상이면 시안색이다.
- SAT 차이가 5°C 이상이면 시안색이다.
- 세 항목 중 하나라도 범위를 넘으면 WIND/SAT 전체를 시안색으로 표시한다.
- 범위 안에 있으면 흰색으로 표시한다.
- 초과한 항목만 새 기준값으로 갱신한다.

### STEP ALT 매칭

STEP ALT의 waypoint와 고도가 CRZ WIND의 waypoint와 FL에 모두 일치하면, 해당 고도의 WIND/SAT만 그린색으로 표시한다. 이 규칙은 시안색/흰색 규칙보다 우선한다.

첫 번째 CRZ WIND waypoint의 첫 번째 고도는 STEP ALT의 첫 번째 유효 waypoint가 가진 FL을 기준으로 매칭한다.

## 검증

- `node --check app.js`
- `git diff --check`
- 서로 다른 OFP의 노선명, 3글자 waypoint, 좌표 waypoint, CMP 부호 형식을 기준으로 파싱 로직을 점검했다.
