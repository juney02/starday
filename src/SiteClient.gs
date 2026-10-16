/**
 * 공식 사이트 점검 도구 (소유자가 편집기에서만 실행)
 *
 * inspectOfficialPage(): 공식 페이지를 "한 번만" 읽어서 구조를 로그로 보여 준다. (저장하지 않는다)
 *   1) robots.txt  2) 페이지 본문 전체(작은 페이지라면)  3) 페이지가 쓰는 스크립트 주소 목록
 *   4) 같은 사이트의 스크립트 안에서 "데이터를 불러오는 주소"로 보이는 부분
 * 이 결과로 수집 방식(HTML 분석 / 데이터 주소 호출 / 이미지)을 정한다.
 * 사이트가 막거나 로그인이 필요하면 우회하지 않고 거기서 멈춘다.
 */
const OFFICIAL_PAGE_URL = 'https://www.asahi.co.jp/ohaasa/week/horoscope/';
const OFFICIAL_ROBOTS_URL = 'https://www.asahi.co.jp/robots.txt';

function siteGet_(url) {
  const r = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Byeolharu/0.2 (personal-use)', 'Accept-Language': 'ja,ko;q=0.8' },
  });
  return { code: r.getResponseCode(), body: r.getContentText(), headers: r.getHeaders() };
}

/** 상대 주소를 절대 주소로 */
function absUrl_(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (/^\/\//.test(ref)) return 'https:' + ref;
  const m = /^(https?:\/\/[^\/]+)(\/.*)?$/.exec(base);
  const origin = m[1], dir = (m[2] || '/').replace(/[^\/]*$/, '');
  if (ref.charAt(0) === '/') return origin + ref;
  const parts = (dir + ref).split('/'), out = [];
  parts.forEach(function (p) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); });
  return origin + out.join('/');
}

/* ============================================================================
 * 공식 사이트(朝日放送テレビ「おはよう朝日です」) 데이터 수집
 *
 * 공식 페이지(/ohaasa/week/horoscope/)는 빈 틀이고, 순위는 아래 JSON 파일을 자바스크립트가 불러와서 그린다.
 * 같은 파일을 하루 몇 번만(최대 4번, 이미 받았으면 안 부름) 조회한다. 로그인·차단 우회는 하지 않는다.
 *
 * 파일 모양 (점검으로 확인함):
 *   [ { horoscope_id, onair_date:'20261015', open_st, detail:[
 *        { ranking_no:'1', horoscope_st:'03'(별자리 번호 1~12), horoscope_text:'문장1\t문장2\t문장3\t\t\t행운 항목' }, ... ] } ]
 * 사이트 구조가 바뀌면 parseOhaasaJson_ 이 오류(FORMAT)를 내고 멈춘다. 잘못 읽은 값을 공개하지 않는다.
 * ========================================================================== */
const OFFICIAL_DATA_URL = 'https://www.asahi.co.jp/data/ohaasa2020/horoscope.json';
const OHAASA_SIGN_BY_NO_ = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
// 행운 항목이 "색"인지 구분하기 위한 단어 (정확히 일치할 때만 색으로 본다. 모호하면 아이템으로 두고 관리자가 고친다)
const OHAASA_COLOR_WORDS_ = ['赤', '青', '緑', '黄', '白', '黒', '茶', '紫', '桃', '灰', '金', '銀', '紺', '橙', '水色', '空色', '黄緑', '黄色', '茶色', '金色', '銀色', '赤色', '青色', '緑色', '白色', '黒色', '紫色',
  'ピンク', 'オレンジ', 'イエロー', 'ブルー', 'グリーン', 'レッド', 'ホワイト', 'ブラック', 'パープル', 'グレー', 'ベージュ', 'ゴールド', 'シルバー', 'ブラウン', 'ネイビー', 'ターコイズ', 'ラベンダー', 'ライトブルー'];

function siteErr_(code, message) { const e = new Error(message); e.xcode = code; return e; }

/** 전각 영숫자 → 반각 (ＧＯＯＤ → GOOD). 나머지 문자는 그대로 둔다 */
function halfWidthAlnum_(s) {
  return String(s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}

/**
 * 공식 JSON → 내부 형식. (네트워크 없이 시험할 수 있게 분리해 둠)
 * @return {{date:string, id:string, items:Array, warnings:string[]}}
 */
function parseOhaasaJson_(json) {
  const h = Array.isArray(json) ? json[0] : null;
  if (!h || !/^\d{8}$/.test(String(h.onair_date || '')) || !Array.isArray(h.detail)) throw siteErr_('FORMAT', '공식 사이트 데이터 형식이 예상과 달라요. (사이트가 바뀌었을 수 있어요)');
  const od = String(h.onair_date);
  const out = { date: od.slice(0, 4) + '-' + od.slice(4, 6) + '-' + od.slice(6, 8), id: String(h.horoscope_id || ''), items: [], warnings: [] };

  h.detail.forEach(function (d) {
    const no = parseInt(d.horoscope_st, 10), rank = parseInt(d.ranking_no, 10);
    const sign = OHAASA_SIGN_BY_NO_[no - 1];
    if (!sign) { out.warnings.push('알 수 없는 별자리 번호: ' + d.horoscope_st); return; }
    const segs = String(d.horoscope_text || '').split('\t').map(function (x) { return halfWidthAlnum_(x.trim()); });
    const nonEmpty = segs.filter(Boolean);
    // 마지막 칸이 비어 있는 칸 바로 뒤에 있으면 "행운 항목", 아니면 전부 설명으로 본다
    const hasLucky = segs.length >= 2 && segs[segs.length - 1] !== '' && segs[segs.length - 2] === '';
    const lucky = hasLucky ? nonEmpty[nonEmpty.length - 1] : '';
    const desc = (hasLucky ? nonEmpty.slice(0, -1) : nonEmpty).join('\n');
    const isColor = lucky && OHAASA_COLOR_WORDS_.indexOf(lucky) >= 0;
    out.items.push({
      sign: sign, rank: isNaN(rank) ? null : rank, content_ja: desc,
      lucky_item_ja: isColor ? '' : lucky, lucky_color_ja: isColor ? lucky : '',
    });
  });
  return out;
}

const SiteClient = {
  /** 공식 데이터 파일을 조회. 일시적 장애(5xx/네트워크)는 2초·4초 간격으로 최대 2번만 재시도 */
  fetchHoroscope: function () {
    const waits = [2000, 4000];
    let last = null;
    for (let i = 0; i <= waits.length; i++) {
      let r;
      try { r = siteGet_(OFFICIAL_DATA_URL); }
      catch (e) { last = siteErr_('NETWORK', '네트워크 오류: ' + e.message); r = null; }
      if (r) {
        if (r.code === 200) {
          let json;
          try { json = JSON.parse(r.body); } catch (e) { throw siteErr_('FORMAT', '공식 사이트 데이터가 JSON 형식이 아니에요.'); }
          return parseOhaasaJson_(json);
        }
        if (r.code === 401 || r.code === 403) throw siteErr_('FORBIDDEN', '공식 사이트가 접근을 막았어요(HTTP ' + r.code + '). 우회하지 않고 멈춥니다.');
        if (r.code === 429) throw siteErr_('RATE_LIMIT', '공식 사이트가 요청이 너무 많다고 해요(429). 다음 확인 때 다시 시도합니다.');
        if (r.code === 404) throw siteErr_('NOT_FOUND', '공식 사이트에서 데이터 파일을 찾지 못했어요(404). 주소가 바뀌었을 수 있어요.');
        if (r.code < 500) throw siteErr_('BAD_RESPONSE', '공식 사이트 응답 오류(HTTP ' + r.code + ').');
        last = siteErr_('SERVER', '공식 사이트 서버 오류(HTTP ' + r.code + ').');
      }
      if (i < waits.length) Utilities.sleep(waits[i]);
    }
    throw last;
  },
};

/**
 * 압축된(한 줄짜리) 스크립트에서 키워드 주변 글자만 뽑는다. 데이터 주소를 부르는 코드를 찾기 위한 것.
 * 예: main.min.js 안의 "oa_horoscope" 근처
 */
function inspectMainScript() {
  requireOwner_();
  const url = 'https://www.asahi.co.jp/ohaasa/js/main.min.js';
  const r = siteGet_(url);
  Logger.log('[' + url + '] HTTP ' + r.code + ' / ' + r.body.length + '자');
  if (r.code !== 200) return;

  const show = function (label, re, width, max) {
    let m, n = 0;
    while ((m = re.exec(r.body)) && n < max) {
      const from = Math.max(0, m.index - width), to = Math.min(r.body.length, m.index + width);
      Logger.log('--- ' + label + ' #' + (n + 1) + ' (위치 ' + m.index + ') ---\n' + r.body.slice(from, to));
      n++;
      re.lastIndex = m.index + 1 + width;   // 같은 주변을 중복으로 보여 주지 않는다
    }
    if (!n) Logger.log('--- ' + label + ': 없음 ---');
  };
  show('oa_horoscope', /oa_horoscope/g, 450, 4);
  show('데이터 파일 주소(.json)', /["'][^"']*\.json[^"']*["']/g, 160, 6);
  show('page_type', /page_type/g, 250, 2);
  Logger.log('끝. 위 로그를 복사해서 알려주세요.');
}

/** main.min.js에서 데이터 파일 주소(_endPoints, _jsonPath)와 항목 이름(_templateHoroscopeSing)이 있는 부분만 뽑는다 */
function inspectDataEndpoint() {
  requireOwner_();
  const r = siteGet_('https://www.asahi.co.jp/ohaasa/js/main.min.js');
  Logger.log('HTTP ' + r.code + ' / ' + r.body.length + '자');
  if (r.code !== 200) return;
  const show = function (label, re, before, after, max) {
    let m, n = 0;
    while ((m = re.exec(r.body)) && n < max) {
      Logger.log('--- ' + label + ' #' + (n + 1) + ' ---\n' + r.body.slice(Math.max(0, m.index - before), m.index + after));
      n++; re.lastIndex = m.index + after;
    }
    if (!n) Logger.log('--- ' + label + ': 없음 ---');
  };
  show('_jsonPath', /_jsonPath\s*=/g, 200, 700, 2);
  show('_endPoints', /_endPoints\s*=/g, 100, 900, 2);
  show('_templateHoroscopeSing 정의', /key:"_templateHoroscopeSing"/g, 0, 1300, 1);
  show('horoscope 파일명', /horoscope\.json|"horoscope"/g, 200, 300, 3);
  Logger.log('끝. 위 로그를 복사해서 알려주세요.');
}

/**
 * 사이트 스크립트가 실제(public)로 쓰는 horoscope.json 주소를 찾아서 그 파일을 "한 번" 읽고 구조를 보여 준다.
 * (개발용 local 주소가 아니라 public 쪽 주소만 사용)
 */
function inspectPublicData() {
  requireOwner_();
  const js = siteGet_('https://www.asahi.co.jp/ohaasa/js/main.min.js');
  if (js.code !== 200) { Logger.log('main.min.js를 읽지 못했어요: HTTP ' + js.code); return; }

  const pub = /public:\{top:\["([^"]+)"/.exec(js.body);
  Logger.log('public 주소 후보: ' + (pub ? pub[1] : '못 찾음'));
  if (!pub) {
    const i = js.body.indexOf('public:{');
    Logger.log('public 부분: ' + (i >= 0 ? js.body.slice(i, i + 600) : '없음'));
    return;
  }
  const url = absUrl_('https://www.asahi.co.jp/ohaasa/', pub[1]);
  const r = siteGet_(url);
  Logger.log('[' + url + '] HTTP ' + r.code + ' / ' + r.body.length + '자 / Content-Type ' + (r.headers['Content-Type'] || r.headers['content-type']));
  if (r.code !== 200) return;

  let json;
  try { json = JSON.parse(r.body); } catch (e) { Logger.log('JSON이 아니에요. 앞부분: ' + r.body.slice(0, 500)); return; }
  Logger.log('최상위 키: ' + Object.keys(json).join(', '));
  const h = json.horoscope && json.horoscope[0];
  if (!h) { Logger.log('horoscope[0]이 없어요. 앞부분: ' + r.body.slice(0, 800)); return; }
  Logger.log('horoscope[0] 키: ' + Object.keys(h).join(', ') + ' / onair_date=' + h.onair_date + ' / detail ' + (h.detail || []).length + '개');
  if (h.detail && h.detail.length) {
    Logger.log('detail[0] 키: ' + Object.keys(h.detail[0]).join(', '));
    Logger.log('detail 앞 2개 예시:\n' + JSON.stringify(h.detail.slice(0, 2)).slice(0, 1200));
    Logger.log('순위·별자리 번호: ' + h.detail.map(function (d) { return d.ranking_no + ':' + d.horoscope_st; }).join(', '));
  }
  Logger.log('끝. 위 로그를 복사해서 알려주세요.');
}

function inspectOfficialPage() {
  requireOwner_();
  const page = siteGet_(OFFICIAL_PAGE_URL);
  Logger.log('[페이지] HTTP ' + page.code + ' / ' + page.body.length + '자');
  if (page.code !== 200) { Logger.log('페이지를 가져오지 못했어요. 접근이 막혔다면 우회하지 말고 여기서 멈추세요.'); return; }

  // 본문 뒷부분 (앞부분은 이미 확인함): 1400자부터
  Logger.log('--- 본문 1400자 이후 ---\n' + page.body.slice(1400, 3800));

  // 스크립트 주소 목록
  const srcs = [], re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(page.body))) srcs.push(absUrl_(OFFICIAL_PAGE_URL, m[1]));
  Logger.log('--- 스크립트 주소 ' + srcs.length + '개 ---\n' + srcs.join('\n'));

  // 같은 사이트(asahi.co.jp)의 스크립트만 읽어서 데이터 주소 후보를 찾는다
  const own = srcs.filter(function (u) { return /^https:\/\/www\.asahi\.co\.jp\//.test(u); });
  own.forEach(function (u) {
    const r = siteGet_(u);
    if (r.code !== 200) { Logger.log('[' + u + '] HTTP ' + r.code); return; }
    const hits = [];
    r.body.split(/\r?\n/).forEach(function (line) {
      if (/(\.json|\.php|\.xml|ajax|fetch\(|XMLHttpRequest|horoscope|seiza|ohaasa|api)/i.test(line) && line.length < 400) hits.push(line.trim());
    });
    Logger.log('[' + u + '] ' + r.body.length + '자 / 관련 줄 ' + hits.length + '개' + (hits.length ? '\n' + hits.slice(0, 12).join('\n') : ''));
  });
  Logger.log('점검 끝. 위 로그를 복사해서 알려주세요.');
}
