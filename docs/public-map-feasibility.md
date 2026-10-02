# 브라우저 직접 접근 공개 지도 서비스 조사

조사 버전 **1.0 · 2026-10-01**. 관찰 시각은 **05:50–05:56 KST**이며 아래 원본
ISO 시각은 UTC다. 서버·중계·API 키·유료 서비스·사용자 계정을 추가하지 않는
`decisions.json` v2의 4-B/5-A를 기준으로 판단했다. 공개 서울시청 인근 fixture만
요청했으며 사용자 GPS나 개인 데이터는 조회하지 않았다.

**전용 OSRM 도보 경로와 Transitous의 coarse 역지오코딩은 한국 fixture에서 HTTP와
브라우저 CORS 응답을 확인했다. 한국 대중교통 경로 검증은 미검증이다.** 이용 조건
준수와 앱 통합은 별도이며, 이번 응답만으로 상용 운영·전국 범위·실기기 동작을
검증했다고 말할 수 없다. 실제 공급자가 비활성화되거나 근거가 부족하면 다른 검증
가능 후보를 찾고, 없으면 기존 일정을 유지한다.

## 확인 범위별 판정

`verified`는 그 열의 관찰에만 해당한다. `unverified`는 미관찰·불명확·준수 조건
미충족이며 서비스 자체가 불가능하다는 뜻이 아니다. `impossible`은 해당 수단이나
제품 제약 아래 사용할 수 없다고 확인한 경우다. 예약 도착 여부의 세 상태는
[공통 계약](ai-flow-contract.md)의 별도 계산 결과다.

| 서비스·용도                    | 키/계정         | 한국 데이터                                                                     | HTTP/CORS                                                     | 채택 판정                                                                       |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| FOSSGIS OSRM `routed-foot`     | 불필요          | 서울 도보 fixture verified, 전국 품질 unverified                                | HTTP 200, ACAO `*`, 로컬 브라우저 cors readable verified      | 조건부 도보 adapter 후보. 앱 통합/운영 조건은 아직 unverified                   |
| 기본 `router.project-osrm.org` | 불필요          | 같은 fixture 응답 있음                                                          | HTTP 200, ACAO `*` verified; 이 host의 브라우저 요청은 미수행 | 도보 판정에 사용 impossible. `walking` 문자열로 차량 graph를 바꿀 수 없음       |
| Transitous MOTIS 역지오코딩    | 불필요          | 서울 `areas`에 city/borough/suburb verified                                     | HTTP 200, ACAO `*`, 로컬 브라우저 cors readable verified      | 비상업·오픈소스·경량 사용과 attribution/contact 준수 시 coarse adapter 후보     |
| Transitous MOTIS 대중교통      | 불필요          | 한국 KTDB/코레일 sources 존재 verified; 이 날짜·동선 운행 커버리지는 unverified | 경로 API 요청 미수행, 해당 endpoint CORS도 unverified         | 사전 문의 조건/시간표·경로 미확인. 기본 비활성, transit 비교 unverified         |
| OSMF 공개 Nominatim reverse    | 불필요          | 공개 서울 fixture 주소 응답 verified                                            | HTTP 200, ACAO `*`, 로컬 브라우저 cors readable verified      | 실제 사용자 GPS용 채택 impossible: 개인정보 제출 제한. 공개 fixture 성공과 구분 |
| Kakao Local/Map API            | 앱 등록·키 필요 | 한국용 API 문서 있음                                                            | 인증 요청/CORS 실험 미수행                                    | 4-B 아래 impossible. 키 없는 대안으로 취급하지 않음                             |

이 표는 모든 서비스가 없다는 전수조사 결론이 아니다. Valhalla·Photon 등 다른 공개
인스턴스의 한국 품질·개인정보·운영 조건은 확인하지 않았고 fallback 목록에 넣지 않았다.
OSRM에는 대중교통 시간표/환승 API가 없으므로 OSRM의 transit 검증은 impossible다.
OSRM 도보 성공을 Transitous transit 성공으로 대신하지 않는다.

## 이용 조건과 운영 경계

### FOSSGIS OSRM

권위 출처는 [서비스 설명](https://routing.openstreetmap.de/about.html),
[FOSSGIS 이용 조건](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/),
[개인정보 정책](https://www.fossgis.de/datenschutzerkl%C3%A4rung),
[OSRM demo 설명](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)이다.
서비스의 현재 프런트 설정은 도보 endpoint를
`https://routing.openstreetmap.de/routed-foot/route/v1/foot`로 명시한다.

- routing 이용 조건: **최대 1 request/second**, 대량 다운로드 금지, 높은 트래픽
  웹사이트 사용 금지. 일반 브라우저 User-Agent와 정상 Referer는 허용된다.
- OSM attribution/license와 [오류 수정 링크](https://www.openstreetmap.org/fixthemap)를
  보여 주고, 웹사이트에 운영자의 연락 가능한 이메일을 명확히 제공해야 한다.
  이메일은 이번 조사에서 사용자가 제공하지 않아 임의로 만들지 않았다. T02는 이를
  공급자 활성화 조건으로 다뤄야 한다.
- FOSSGIS의 본문은 서비스가 주된 상업 제공물이 되는 사용을 제한하고, OSRM demo
  wiki는 합리적인 비상업 사용으로 한정한다. DatePack의 현재 오픈소스 베타를 넘어
  유료·상업 용도를 허용한다고 확장 해석하지 않는다.
- graph는 OSM 데이터에 근거한다. 실시간 보행 폐쇄·날씨·혼잡·영업 여부의 보장은
  없다. 서비스 중단·조건 변경·접근 철회가 가능하고 SLA도 없다.
- 경로 요청에는 endpoint 좌표와 IP 등이 포함되며 URL이 서버 로그에 남을 수 있다.
  위치 사용 동의에서 이 전달을 설명한다. 조사 fixture에는 사용자 위치가 없다.

T02 구현은 단일 queue와 메모리 캐시로 1초보다 긴 간격(권장 1100ms)을 유지하고,
429/403을 만나면 즉시 중단하며 자동 retry storm을 만들지 않는다. 여러 탭도 가능한
범위에서 조정한다. 기기별 제한으로 모든 사용자 합계 준수를 보장했다고 말하지 않는다.
공개 서비스의 전체 사용량 조건을 감당할 수 없는 배포 규모면 provider를 비활성화한다.
작은 실험의 성공만으로 서비스 용량을 주장하지 않는다.

### Transitous

권위 출처는 [API 이용 조건](https://transitous.org/api/),
[sources](https://transitous.org/sources/), [privacy](https://transitous.org/privacy/),
이 API 페이지가 연결한 [MOTIS 2.10.2 OpenAPI](https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml)다.
실제 응답 서버 헤더는 `MOTIS v2.11.3`였다. API 문서와 배포 버전이 다르므로
parser는 필요한 필드만 검사하고 미지원 응답은 미검증으로 처리한다.

- 공개 소스 코드·비상업·적은 자원 사용이 요구된다. 브라우저는 User-Agent 대신
  Referer와 웹사이트 연락 정보를 사용해도 된다. 공개 sources와 OSM attribution을
  보이는 곳에 연결하고 개별 데이터의 사용 조건도 준수한다.
- “Please contact us before using any potentially resource-intensive API endpoints
  (such as routing, isochrones) or doing many requests”라고 명시한다. T01은 운영자에게
  메시지를 보내라는 사용자 지시가 없어 문의·경로 요청을 하지 않았다. 이 조건이
  해결되지 않은 동안 routing adapter를 켜지 않는다. 가벼운 공개 fixture 역지오코딩
  확인은 경로 확인을 대신하지 않는다.
- 요청 URL·IP·시각·User-Agent를 로그에 저장하고 최대 2일 보관한다고 설명한다.
  실제 GPS coarse 변환을 연결하려면 사용자가 서비스와 전달 목적을 알 수 있어야 한다.
- 한국 sources에는 KTDB(표시된 갱신 2025-05-21 14:33 UTC)와 코레일
  (2026-09-23 18:01 UTC)이 있었다. sources의 갱신 시각은 시간표 유효 기간이나
  서울 지하철·버스의 해당 여행 운행 보장이 아니다.
- endpoint는 `https://api.transitous.org`의 공개 API만 사용한다. staging이나 내부
  호스트를 장애 fallback으로 사용하지 않는다. 최신 schema의 plan은 `/api/v6/plan`이고,
  구형 v1 polyline은 longitude >107 문제를 명시하므로 한국 경로를 구형 출력으로
  처리하지 않는다. transit 활성화 전 출발 일시·걷기·환승·시간표 유효성·순서·CORS를
  실제 해당 endpoint에서 검증해야 한다.

### Nominatim과 키가 필요한 API

[Nominatim 정책](https://operations.osmfoundation.org/policies/nominatim/)은 앱 전체
사용자 합계 최대 1 request/second, 식별 가능한 Referer/User-Agent, attribution,
캐시, 공급자 전환 가능성, autocomplete/대량 수집 금지를 요구한다. 특히
“Please do not submit personal data or other confidential material to any of our services”를
명시한다. 사용자 GPS reverse를 기본으로 연결하지 않는다. public fixture 성공은
개인정보 제출 허가가 아니다. 공개 장소명만 조회하는 다른 용도도 별도 책임과
사용량·캐시 조건을 검토해야 하며 이번 작업에서 기본 geocoding 공급자로 채택하지 않았다.

[Kakao 문서](https://developers.kakao.com/docs/latest/ko/local/common)는 앱의 카카오맵
사용 설정과 API별 키 설정을 요구한다. 무료 쿼터가 있어도 키/계정 없는 서비스가 되지
않는다. 중계 서버를 통해 CORS를 해결하거나 지도 웹 UI를 scraping하는 우회는 금지한다.

## 실제 요청과 응답

원시 HTTP 응답·헤더와 브라우저 관찰의 전사는
[증거 JSON](evidence/public-map-probe-2026-10-01.json)에 있다. 아래 좌표는 공개
fixture **시청 부근 (37.5665, 126.9780) → 종각 부근 (37.5700, 126.9830)**다.
실제 방문, 두 장소 입구의 확정, 걷기 현장 검증은 수행하지 않았다.

| 관찰                               | 요청 시각 UTC       | 결과                                                         |
| ---------------------------------- | ------------------- | ------------------------------------------------------------ |
| HTTP foot                          | 2026-09-30 20:50:51 | 200, code Ok, 847m, 677.7초, endpoint snap 3.77m/5.07m       |
| HTTP 기본 host의 walking 문자열    | 20:50:53            | 200, 921.2m, 64.8초; driving control과 route/waypoints 동일  |
| HTTP Nominatim public reverse      | 20:50:55            | 200, 한국 주소와 명동/중구/서울 행정 구역                    |
| 브라우저 foot                      | 20:52:33            | 200, response.type=cors, body 읽기 성공, 847m/677.7초        |
| HTTP Transitous public reverse     | 20:53:18            | 200, ACAO *, `areas`: 대한민국/서울특별시/중구/명동          |
| 브라우저 Nominatim public reverse  | 20:53:21            | 200, response.type=cors, body 읽기 성공; quarter는 태평로1가 |
| 브라우저 Transitous public reverse | 20:53:47            | 200, response.type=cors, body 읽기 성공, 같은 행정 구역      |

Nominatim의 quarter/우편번호가 HTTP와 브라우저 응답에서 달랐다. 같은 좌표가 항상
동일한 상세 주소로 resolve된다고 가정하지 않는다. 이 차이는 불확실성을 기록한 것이며
어느 주소가 실제 입구라고 확정한 것이 아니다.

OSRM 재현 요청은 다음과 같다. API에는 lon,lat 순으로 넣고 전용 **routed-foot**를 쓴다.

```http
GET https://routing.openstreetmap.de/routed-foot/route/v1/foot/126.9780,37.5665;126.9830,37.5700?overview=false&steps=false&generate_hints=false
Origin: https://threelightstudio.github.io
```

```json
{
  "code": "Ok",
  "routes": [{ "duration": 677.7, "distance": 847 }]
}
```

HTTP 요청은 `Origin: https://threelightstudio.github.io`를 붙여 허용 헤더를 관찰했다.
이것만으로 브라우저 성공을 주장하지 않았다. 실제 브라우저는 로컬 테스트 페이지
`http://127.0.0.1:8765/browser-probe.html`에서 버튼을 눌러 `fetch`를 실행했고,
`credentials: omit`, `mode: cors`에서 응답 JSON을 읽었다. production origin·PWA·Safari·
Android에서는 아직 확인하지 않았다. 서버 없는 구조여도 provider로 요청이 나간다.

Transitous coarse 재현 요청은 다음과 같다. MOTIS는 **lat,lon** 순서다.

```http
GET https://api.transitous.org/api/v1/reverse-geocode?place=37.5665,126.9780&type=PLACE,STOP&numResults=3
```

관찰된 `areas`에서 `서울특별시 중구 명동`을 고를 수 있다. 원응답의 lat/lon, houseNumber,
id, score를 AI에 보내지 않는다. 다른 지역에서 areas가 없거나 모호하면 사용자가
주변 기준점을 입력한다. 임의의 nearest POI를 실제 현재 활동 장소라고 단정하지 않는다.

## 후속 구현 활성화 조건

T02는 capability를 용도별로 저장한다. foot, transit, reverse-geocode, place-resolve를
한꺼번에 `available: true`로 묶지 않는다. 최소 조건은 이용 조건 충족, 정상 Referer와
연락/attribution 표시, 해당 지역·수단의 응답 shape 확인, 정확 좌표 전달 동의,
timeout/실패/429 처리, freshness·snap 검증, 공급자 비활성화 수단이다.

전용 foot endpoint가 준비되어도 장소가 이름뿐이면 도보 검증 입력은 부족하다.
공개 장소 검색/좌표 해석은 동명이인·영업 지점·입구를 검토하여 확인해야 한다.
이번 조사에서는 자동 venue-to-coordinate 선택을 검증하지 않았다. 미해결 장소나
정확한 출발점 없이 직선거리로 빈칸을 채우지 않는다.

transit는 사전 문의 조건과 정확한 여행 날짜의 실제 한국 경로 응답·CORS·소스 라이선스
확인 전까지 unverified다. 향후 조건을 충족해도 도보 구간·대기·환승을 포함한 전체
영향 동선을 검증해야 한다. 운영자 문의는 별도 사용자 지시 없이 보내지 않는다.

provider가 없는 실행도 정상 제품 경로다. coarse 실패면 마지막 위치·관찰 시각 또는
직접 장소 입력을 쓰고, 경로를 검증할 수 있는 후보가 없으면 “동선을 확인하지 못해
기존 카페와 18시 예약을 유지했어요”라고 안내한다. 원래 계획의 도착 가능까지 확인한
것처럼 말하지 않는다. 실제 서비스 확인과 모의 adapter 테스트는 결과에서 분리한다.
