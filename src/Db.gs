/**
 * 시트 DB 도우미 (Supabase 테이블 역할을 하는 탭들)
 * - 탭 이름은 Config.gs의 CONFIG.SHEET 값과 같아야 한다. (파일 로딩 순서와 무관하게 동작하도록 여기서는 문자열로 적었다)
 * - 탭이 없으면 만들고, 헤더를 맞춘다. 날짜/시간이 자동 변환되지 않게 서식을 '텍스트'로 둔다.
 */
const TABLES = {};
TABLES['daily_horoscopes'] = [
  'id', 'horoscope_date', 'zodiac_sign', 'rank', 'content_ja', 'content_ko',
  'lucky_item', 'lucky_item_ja', 'lucky_color', 'lucky_color_ja',
  'source_name', 'source_post_id', 'source_post_url', 'source_published_at',
  'translation_status', 'validation_status', 'validation_note', 'publication_status', 'data_mode', 'edited_by_admin',
  'created_at', 'updated_at',
];
TABLES['import_logs'] = [
  'id', 'source_name', 'started_at', 'completed_at', 'checked_post_ids', 'import_status',
  'records_found', 'valid_records', 'error_message', 'trigger', 'data_mode',
];
TABLES['source_settings'] = [
  'id', 'source_name', 'source_username', 'source_url', 'last_checked_at', 'last_success_at',
  'enabled', 'authorization_status', 'x_user_id', 'notes',
];
TABLES['source_posts'] = [
  'post_id', 'post_url', 'published_at', 'horoscope_date', 'classification', 'media_count', 'data_mode', 'checked_at',
];

const Db = {
  /** 탭 가져오기 (없으면 만든다) */
  sheet: function (name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(name);
    const headers = TABLES[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  },

  /** 모든 행을 객체 배열로. 각 객체에 _row(시트 행 번호)가 붙는다 */
  readAll: function (name) {
    const sh = this.sheet(name);
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    const headers = values[0].map(String);
    const rows = [];
    for (let r = 1; r < values.length; r++) {
      const o = { _row: r + 1 };
      let any = false;
      headers.forEach(function (h, c) {
        let v = values[r][c];
        if (v instanceof Date) v = Utilities.formatDate(v, CONFIG.TIMEZONE, /date$/.test(h) ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
        if (v !== '' && v !== null) any = true;
        o[h] = (v === null || v === undefined) ? '' : v;
      });
      if (any) rows.push(o);
    }
    return rows;
  },

  append: function (name, obj) {
    const sh = this.sheet(name);
    const headers = TABLES[name];
    const row = headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
    const next = sh.getLastRow() + 1;
    sh.getRange(next, 1, 1, headers.length).setValues([row]);
    return next;
  },

  /** 시트 행 번호(rowNo)의 일부 칸만 바꾼다 */
  update: function (name, rowNo, patch) {
    const sh = this.sheet(name);
    const headers = TABLES[name];
    const cur = sh.getRange(rowNo, 1, 1, headers.length).getValues()[0];
    const next = headers.map(function (h, i) { return patch.hasOwnProperty(h) ? patch[h] : cur[i]; });
    sh.getRange(rowNo, 1, 1, headers.length).setValues([next]);
  },

  /** 큰 행 번호부터 지워야 번호가 밀리지 않는다 */
  deleteRows: function (name, rowNos) {
    const sh = this.sheet(name);
    rowNos.slice().sort(function (a, b) { return b - a; }).forEach(function (n) { sh.deleteRow(n); });
  },
};

/** 소스 설정(1행짜리 테이블) */
const Source = {
  get: function () {
    let rows = Db.readAll(CONFIG.SHEET.SOURCES).filter(function (r) { return r.id === CONFIG.SOURCE_ID; });
    if (!rows.length) {
      Db.append(CONFIG.SHEET.SOURCES, {
        id: CONFIG.SOURCE_ID, source_name: CONFIG.SOURCE_NAME, source_username: CONFIG.DEFAULT_USERNAME,
        source_url: CONFIG.OFFICIAL_ACCOUNT_URL, enabled: 'true',
        authorization_status: 'UNVERIFIED',   // UNVERIFIED | LINK_ONLY | APPROVED
        notes: '재배포·저장·번역 허락이 확인되면 APPROVED로 바꾸세요.',
      });
      rows = Db.readAll(CONFIG.SHEET.SOURCES).filter(function (r) { return r.id === CONFIG.SOURCE_ID; });
    }
    return rows[0];
  },
  patch: function (patch) { const s = this.get(); Db.update(CONFIG.SHEET.SOURCES, s._row, patch); },
  enabled: function () { return String(this.get().enabled) !== 'false'; },
  authorization: function () { return String(this.get().authorization_status || 'UNVERIFIED'); },
};

/** 편집기에서 한 번 실행하면 모든 DB 탭을 준비한다 */
function setupSheets() {
  requireOwner_();
  Object.keys(TABLES).forEach(function (n) { Db.sheet(n); });
  Source.get();
  Logger.log('DB 탭 준비 완료: ' + Object.keys(TABLES).join(', '));
}
