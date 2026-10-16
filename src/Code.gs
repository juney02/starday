/**
 * 별하루(BYEOLHARU) - 웹앱 입구
 *
 *  Code.gs      doGet(사용자 화면 / ?page=admin 관리자 화면), 사용자 화면이 부르는 함수
 *  Config.gs    설정·시간 도우미        Zodiac.gs    별자리 이름 변환
 *  Db.gs        시트 DB 도우미          Horoscope.gs 운세 조회 서비스(사용자용)
 *  XClient.gs   X 공식 API 클라이언트   TestFeed.gs   테스트용 가상 게시물
 *  Parser.gs    게시물 분석·검증        Translate.gs 번역    ImageOcr.gs 이미지 분석
 *  Import.gs    자동 수집 파이프라인·스케줄러(tick)   AdminApi.gs 관리자 기능
 *  MockData.gs  테스트용 가상 운세(저장된 테스트 데이터가 없을 때)
 *
 * ※ 이름 끝에 _ 가 없는 전역 함수는 화면에서 google.script.run으로 호출할 수 있다.
 *   그래서 누구나 써도 되는 것(getHoroscopes 등)만 공개하고, 나머지는 관리자 인증을 거친다.
 */

function doGet(e) {
  const page = e && e.parameter && e.parameter.page;
  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('Admin').evaluate()
      .setTitle('별하루 관리자').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('별하루')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** HTML 파일 안에서 다른 HTML 파일을 끼워 넣을 때 사용 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** 사용자 화면: 해당 날짜의 12별자리 운세 (생략하면 오늘) */
function getHoroscopes(dateStr) {
  ensureRealSetup_();          // 처음 한 번: 실제 운세 모드로 자동 설정 (Setup.gs)
  return HoroscopeService.getByDate(dateStr);
}

/** 사용자 화면: 달력에서 운세를 볼 수 있는 날짜 ('yyyy-MM') */
function getAvailableDates(month) {
  ensureRealSetup_();
  return HoroscopeService.availableDates(month);
}
