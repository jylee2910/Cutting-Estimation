# 재단견적 프로그램 — 앱 형태 제안 및 단계별 개발 계획

## 1. 앱 형태: 웹 앱 (브라우저 실행) 으로 결정

### 비교

| 항목 | 데스크톱 (C# WinForms + DevExpress) | 웹 (TypeScript, 브라우저) |
|---|---|---|
| 벡터 파일 해석 | netDxf, PdfPig, Svg.NET 등 개별 라이브러리 조합 필요 | SVG는 브라우저가 기본 해석, PDF/AI는 pdf.js, DXF는 dxf-parser — 검증된 라이브러리가 한 생태계에 모여 있음 |
| 도면·배치 화면 그리기 | GDI+로 확대/이동/선택을 직접 구현 | SVG로 확대/이동/클릭 선택이 간단 |
| 윤곽 기반 배치(2단계) | 참고 구현이 적음 | SVGnest/Deepnest 등 오픈소스 참고 구현, Clipper(오프셋) JS판 존재 |
| 배포·사용 | PC마다 설치·업데이트 | 설치 없음. 사무실 PC·노트북·태블릿에서 주소만 열면 사용 |
| 견적서 출력 | DevExpress 리포트 (라이선스 필요) | 브라우저 인쇄 → PDF, CSV(엑셀) |
| 개발자 익숙도 | 매우 높음 | 낮은 편 (TypeScript) |
| DB 연동 | MSSQL 직결 | 2단계에서 ASP.NET Core API + MSSQL로 연결 (기존 경험 활용) |

**결정 근거**
- 이 프로그램의 핵심 난이도는 *벡터 파일 해석*과 *도형 화면 처리*인데, 이 두 가지는 웹 쪽 라이브러리가 훨씬 성숙해 있습니다.
- 1차 버전은 **서버 없이 브라우저만으로 동작**합니다 (판재·단가 설정은 브라우저에 저장, 작업은 JSON 파일로 저장/열기). 사내 PC에 정적 파일만 올려두거나 로컬에서 바로 열어 쓸 수 있습니다.
- 계산 로직(`web/src/core`)은 화면과 분리된 순수 함수라서, 필요하면 C#으로 옮기거나 WinForms 안에 **WebView2로 그대로 띄우는** 방식으로도 이어갈 수 있습니다. 즉 웹을 택해도 .NET 환경과 나중에 합칠 길이 열려 있습니다.
- 견적 이력·고객·단가표를 여러 사람이 공유해야 하는 시점(2단계)에 **ASP.NET Core Web API + MSSQL** 백엔드를 붙입니다. 이 부분은 개발자의 기존 경험(C#, .NET, MSSQL)을 그대로 쓸 수 있습니다.

### 기술 스택 (1차)
- React 19 + TypeScript + Vite (화면)
- pdf.js (PDF, PDF 호환 AI 해석), dxf-parser (DXF), svgpath + DOMParser (SVG)
- Vitest (단위 테스트)

## 2. 지원 파일 형식 판단

| 형식 | 1차 지원 | 비고 |
|---|---|---|
| SVG | ✅ | mm/cm/in/pt 단위, viewBox, transform, `<use>`, CSS 클래스 스타일 처리. 단위 없는 일러스트레이터 SVG는 1px=1pt로 해석 |
| DXF (ASCII) | ✅ | LINE/ARC 조각 자동 연결, LWPOLYLINE(bulge)/POLYLINE/CIRCLE/ELLIPSE/SPLINE, 블록(INSERT, 회전·배율·배열), TEXT/MTEXT/DIMENSION 텍스트, $INSUNITS 단위 |
| PDF | ✅ | 벡터 경로 추출(변환 행렬·Form XObject 반영), 실제 크기(pt→mm), 페이지별 도면, 페이지 테두리 자동 제외, 텍스트에서 규격(W×H) 후보 추출 |
| AI | ✅ (PDF 호환 저장 시) | 일러스트레이터 기본 저장 옵션 'PDF 호환 파일 만들기'가 켜져 있으면 PDF로 읽음 |
| EPS | ❌ → 3단계 | PostScript 해석이 필요(Ghostscript). 서버 변환으로 처리 예정. 현재는 PDF/SVG로 저장 안내 |
| DWG | ❌ | 상용 라이브러리 필요. DXF로 저장 안내 |
| 스캔/이미지 PDF | ❌ | 형상 인식 불가 → 텍스트 규격 후보 또는 직접 입력 사용 |

## 3. 단계별 계획

### 1단계 (MVP, 이번 구현) — "시안 불러오기 → 판재 장수 → 대략 견적"
- [x] 시안 불러오기: SVG / DXF / PDF / AI(PDF 호환), 여러 파일·여러 페이지
- [x] 형상 인식: 닫힌 윤곽의 포함 관계로 부품(바깥 윤곽 + 구멍 + 내부선) 인식, 중복선 제거, 끊어진 선 연결
- [x] 형상 선정: 도면 클릭/목록 선택, 같은 형상 자동 묶음(수량 합산, 90° 회전 동일 판별), 세트 묶음, 테두리·치수선 제외, 레이어/색상 필터
- [x] 규격: 도면값 자동 읽기 + 직접 수정(비율 고정), 도면 배율·기준 치수 보정, 텍스트 규격 후보 → 사각 제품 추가, 규격 직접 입력
- [x] 판재 설정: 판재 종류·두께·규격·장당 단가·가공 단가 등록 (브라우저 저장)
- [x] 배치: **외접 사각형 기준 MaxRects 배치** (정렬 4종 × 배치 규칙 4종 중 최소 장수 선택, 단일 규격은 격자 배치와 비교), 부품 간격·판 여백, 회전 허용, 판보다 큰 부품 경고
- [x] 배치 결과 화면: 판재별 장수·효율, 판별 배치도(동일 배치 묶음 표시), 제품별 판당 최대 수량
- [x] 견적: 자재비(전체 장수 / 마지막 장 비율 청구), 가공비(가공 길이 m × 판재별 단가), 개당 가공비, 기본 작업비, 추가 항목(건당/개당/장당/m당/㎡당), 이윤·관리비 %, 최소 작업 금액, 금액 단위 처리, 부가세, 제품별 참고 단가
- [x] 출력: 견적서 화면, 인쇄/PDF 저장(A4), CSV(엑셀) 내보내기, 작업 파일(JSON) 저장/열기

### 2단계 — 정확도 향상 + 데이터 공유
- **실제 윤곽 기반 배치(True-shape nesting)**: No-Fit Polygon + 유전 알고리즘(SVGnest 방식), Web Worker에서 계산. 원형·별·글자처럼 사각형 대비 빈 공간이 큰 형상에서 판재 절감 효과가 큼
- 공구경/커프 오프셋(Clipper)으로 간격을 윤곽 기준으로 적용
- 여러 판재 규격 중 최소 비용 판재 자동 추천 (예: 3×6 vs 4×8)
- ASP.NET Core Web API + MSSQL: 판재·단가표, 고객, 견적 이력 저장/검색, 사용자 공유
- 견적서 양식(회사 로고·직인·계좌), 엑셀(xlsx) 출력

### 3단계 — 실무 확장
- EPS 지원 (서버에서 Ghostscript로 PDF 변환)
- 잔재(남은 판재) 관리 및 잔재 우선 배치
- 결 방향, 공통 절단선(Common-line), 가공 순서 등 세부 옵션
- 절단 파일(DXF) 내보내기로 생산 연계

## 4. 데이터 구조 요약

```
Drawing   { contours[ {pts(mm), closed, layer} ], texts[], unitNote, pageSize? }
Shape     { outer, holes[], opens[], bbox, area, cutLength, signature }   ← 도면에서 인식
Product   { name, parts[ {outer, holes, opens} ], baseW/H, w/h, qty, materialId, allowRotate, lockRatio }
Material  { name, thickness, sheetW, sheetH, pricePerSheet, cutPricePerM }
NestSettings  { gap, margin }
PriceSettings { materialMode, partialStep, setupFee, perPieceFee, extras[], marginRate, vatRate, roundUnit, roundMode, minimumCharge }
MaterialNest  { material, sheets[ {placements[ {x,y,w,h,rotated} ], usedArea} ], oversize[], utilization }
Quote     { lines[], cost, margin, supply, vat, total, products[] }
```
