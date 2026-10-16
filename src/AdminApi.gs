/**
 * 관리자 기능 (서버 쪽)
 *
 * 인증: ① 스크립트 속성 ADMIN_TOKEN과 일치하는 토큰  또는  ② ADMIN_EMAILS에 등록된 구글 계정으로 접속
 *       둘 다 설정하지 않으면 관리자 기능은 완전히 꺼진다. 토큰은 10번 틀리면 10분간 잠긴다.
 * 모든 admin* 함수는 첫 줄에서 requireAdmin_()를 호출한다. (google.script.run으로 누구나 호출을 시도할 수 있으므로)
 */

function requireAdmin_(token) {
  const cache = CacheService.getScriptCache();
  if (cache.get('admin_lock')) throw new Error('LOCKED: 로그인 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.');

  const real = Settings.get('ADMIN_TOKEN', '');
  const emails = Settings.get('ADMIN_EMAILS', '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!real && !emails.length) throw new Error('NOT_CONFIGURED: 관리자 인증이 설정되지 않아 관리자 기능이 꺼져 있어요.');

  if (token && real && safeEqual_(String(token), real)) return;
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { /* 무시 */ }
  if (email && emails.indexOf(email) >= 0) return;

  if (token) {
    const n = parseInt(cache.get('admin_fail') || '0', 10) + 1;
    cache.put('admin_fail', String(n), 600);
    if (n >= 10) cache.put('admin_lock', '1', 600);
    throw new Error('DENIED: 관리자 토큰이 올바르지 않아요.');
  }
  throw new Error('LOGIN: 관리자 토큰을 입력해 주세요.');
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 편집기를 실행한 소유자만 통과 (설정용 함수들이 일반 방문자에게 열리지 않게) */
function requireOwner_() {
  const eff = Session.getEffectiveUser().getEmail(), act = Session.getActiveUser().getEmail();
  if (!eff || eff !== act) throw new Error('이 작업은 프로젝트 소유자가 편집기에서만 실행할 수 있어요.');
}

/** 편집기에서 한 번 실행: 관리자 토큰을 만들어 로그에 보여 준다 (이미 있으면 그대로 보여 준다) */
function setupAdminToken() {
  requireOwner_();
  let t = Settings.get('ADMIN_TOKEN', '');
  if (!t) { t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); Settings.set('ADMIN_TOKEN', t); }
  Logger.log('관리자 토큰(다른 사람에게 알려주지 마세요): ' + t);
}

/* ---------------------------------------------------------------- 조회 */

function adminPing(token) { requireAdmin_(token); return { ok: true, mode: Settings.mode() }; }

function adminOverview(token) {
  requireAdmin_(token);
  return overview_();
}

function overview_() {
  const now = nowParts_(), mode = Settings.mode();
  const src = Source.get();
  const rows = HoroscopeRepo.rowsForDate(now.date, mode);
  const count = function (field, val) { return rows.filter(function (r) { return r[field] === val; }).length; };
  const logs = Db.readAll(CONFIG.SHEET.LOGS).sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; }).slice(0, 15);
  const props = PropertiesService.getScriptProperties();

  return {
    mode: mode, today: now.date, now: stamp_(),
    settings: {
      AUTO_PUBLISH: Settings.bool('AUTO_PUBLISH', false),
      PUBLISH_REQUIRES_TRANSLATION: Settings.get('PUBLISH_REQUIRES_TRANSLATION', 'true') !== 'false',
      TEST_FALLBACK: Settings.bool('TEST_FALLBACK', true),
      TEST_SCENARIO: Settings.get('TEST_SCENARIO', 'normal'),
      PROD_SOURCE: Settings.get('PROD_SOURCE', 'SITE') === 'X' ? 'X' : 'SITE',
      RETENTION_DAYS: Settings.retentionDays(),
      OCR_ENABLED: Settings.bool('OCR_ENABLED', false),
    },
    source: {
      username: src.source_username, url: src.source_url, enabled: String(src.enabled) !== 'false',
      authorization_status: src.authorization_status || 'UNVERIFIED',
      last_checked_at: src.last_checked_at, last_success_at: src.last_success_at,
    },
    secrets: { xToken: Settings.has('X_BEARER_TOKEN'), anthropic: Settings.has('ANTHROPIC_API_KEY'), gemini: Settings.has('GEMINI_API_KEY') },   // 값은 절대 내려보내지 않고 설정 여부만 알린다
    ai: {
      enabled: Settings.bool('AI_ENABLED', true), model: Settings.get('GEMINI_MODEL', AI_DEFAULT_MODEL), fallbackModel: Settings.get('GEMINI_FALLBACK_MODEL', ''),
      dailyLimit: AiAgent.limit_(), usedToday: AiAgent.usedToday(), lastError: Settings.get('AI_LAST_ERROR', ''),
    },
    triggersInstalled: triggersInstalled_(),
    scenarios: TestFeed.scenarios,
    slots: CONFIG.SLOTS.map(function (s) { return { slot: s, done: !!props.getProperty('SLOT_' + now.date + '_' + s) }; }),
    todaySummary: {
      count: rows.length, complete: HoroscopeRepo.isComplete(rows),
      validation: uniqueOf_(rows, 'validation_status'), translation: uniqueOf_(rows, 'translation_status'), publication: uniqueOf_(rows, 'publication_status'),
      published: count('publication_status', STATUS.PUBLISHED),
      official: HoroscopeRepo.officialPost(now.date, mode),
      note: rows.length ? rows[0].validation_note : '',
    },
    logs: logs.map(function (l) { delete l._row; return l; }),
  };
}
function uniqueOf_(rows, f) { const m = {}; rows.forEach(function (r) { m[r[f] || '-'] = true; }); return Object.keys(m); }

function adminRows(token, date) {
  requireAdmin_(token);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('날짜 형식이 올바르지 않아요.');
  return HoroscopeRepo.rowsForDate(date, Settings.mode())
    .sort(function (a, b) { return (Number(a.rank) || 99) - (Number(b.rank) || 99); })
    .map(function (r) { delete r._row; return r; });
}

/* ---------------------------------------------------------------- 작업 */

/** "지금 데이터 확인" */
function adminRunImport(token) {
  requireAdmin_(token);
  const result = Importer.run('MANUAL', { force: true });
  return { result: result, overview: overview_() };
}

/** 한 행 수정. 수정한 행은 자동 수집이 덮어쓰지 않는다 */
function adminSaveRow(token, id, patch, confirmDate) {
  requireAdmin_(token);
  const row = Db.readAll(CONFIG.SHEET.HOROSCOPES).filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('해당 행을 찾지 못했어요.');

  const allowed = ['rank', 'content_ja', 'content_ko', 'lucky_item', 'lucky_item_ja', 'lucky_color', 'lucky_color_ja', 'translation_status'];
  const clean = {};
  Object.keys(patch || {}).forEach(function (k) {
    if (allowed.indexOf(k) < 0) return;
    let v = patch[k];
    if (k === 'rank') { v = (v === '' || v === null) ? '' : Number(v); if (v !== '' && !(v >= 1 && v <= 12 && Math.floor(v) === v)) throw new Error('순위는 1~12 사이의 정수여야 해요.'); }
    else if (k === 'translation_status') { if (['NONE', 'PENDING', 'DONE', 'REVIEW', 'FAILED'].indexOf(v) < 0) throw new Error('번역 상태 값이 올바르지 않아요.'); }
    else v = String(v == null ? '' : v).slice(0, 2000);
    clean[k] = v;
  });
  clean.edited_by_admin = 'true';
  clean.updated_at = stamp_();
  Db.update(CONFIG.SHEET.HOROSCOPES, row._row, clean);

  revalidateDate_(row.horoscope_date, row.data_mode, !!confirmDate);
  HoroscopeRepo.invalidate(row.horoscope_date);
  return adminRows(token, row.horoscope_date);
}

/** 날짜의 모든 행을 다시 검증해서 validation_status를 갱신. 문제가 생기면 공개 중이던 데이터를 비공개로 돌린다 */
function revalidateDate_(date, mode, confirmDate) {
  const rows = HoroscopeRepo.rowsForDate(date, mode);
  const before = rows.map(function (r) { return r.validation_note || ''; }).join(' ');
  const dateProblem = /운세 날짜\(|운세 기준 날짜를/.test(before) && !confirmDate;     // 날짜 문제는 관리자가 직접 확인했다고 해야 풀린다

  const v = validateHoroscope_(
    rows.map(function (r) { return { sign: r.zodiac_sign, rank: r.rank, content_ja: r.content_ja }; }),
    { expectedDate: date, parsedDate: dateProblem ? null : date, authorOk: true, warnings: [], fromImage: false });
  const note = v.errors.concat(v.warnings).join(' / ').slice(0, 500);
  const now = stamp_();
  rows.forEach(function (r) {
    const patch = { validation_status: v.status, validation_note: note, updated_at: now };
    if (v.status === 'INVALID' && r.publication_status === STATUS.PUBLISHED) patch.publication_status = STATUS.REVIEW;
    Db.update(CONFIG.SHEET.HOROSCOPES, r._row, patch);
  });
  return v;
}

/** 공개 / 비공개 */
function adminSetPublication(token, date, action, confirmReviewed) {
  requireAdmin_(token);
  const mode = Settings.mode();
  const rows = HoroscopeRepo.rowsForDate(date, mode);
  if (!rows.length) throw new Error('이 날짜의 데이터가 없어요.');
  const now = stamp_();

  if (action === 'unpublish') {
    rows.forEach(function (r) { Db.update(CONFIG.SHEET.HOROSCOPES, r._row, { publication_status: STATUS.HIDDEN, updated_at: now }); });
  } else if (action === 'publish') {
    if (!HoroscopeRepo.isComplete(rows)) throw new Error('12별자리와 1~12위가 모두 갖춰져야 공개할 수 있어요.');
    const v = revalidateDate_(date, mode, false);
    if (v.status === 'INVALID') throw new Error('검증에 실패해서 공개할 수 없어요: ' + v.errors.join(' / '));
    if (v.status === 'NEEDS_REVIEW' && !confirmReviewed) throw new Error('검토가 필요한 항목이 있어요. 내용을 확인했다면 "검토 완료"에 체크하고 다시 눌러 주세요. (' + v.warnings.join(' / ') + ')');
    if (mode === 'PRODUCTION' && Source.authorization() !== 'APPROVED') throw new Error('출처 이용 허락 상태가 APPROVED가 아니라서 운영 모드에서는 공개할 수 없어요.');
    const needTr = Settings.get('PUBLISH_REQUIRES_TRANSLATION', 'true') !== 'false';
    if (needTr && rows.some(function (r) { return r.content_ja && r.translation_status !== 'DONE'; })) throw new Error('한국어 번역이 완료(DONE)되어야 공개할 수 있어요. 번역을 검수한 뒤 번역 상태를 DONE으로 바꿔 주세요.');
    rows.forEach(function (r) { Db.update(CONFIG.SHEET.HOROSCOPES, r._row, { publication_status: STATUS.PUBLISHED, updated_at: now }); });
  } else throw new Error('알 수 없는 작업이에요.');

  HoroscopeRepo.invalidate(date);
  return adminRows(token, date);
}

/** 번역 다시 하기 (수정한 행은 번역이 덮어쓰지 않도록 비어 있는 칸만 채운다) */
function adminTranslate(token, date) {
  requireAdmin_(token);
  const mode = Settings.mode();
  const rows = HoroscopeRepo.rowsForDate(date, mode);
  if (!rows.length) throw new Error('이 날짜의 데이터가 없어요.');
  const items = rows.map(function (r) { return { sign: r.zodiac_sign, content_ja: r.content_ja, lucky_item_ja: r.lucky_item_ja, lucky_color_ja: r.lucky_color_ja }; });
  const tr = Translator.translate(items, mode, Source.authorization());
  const now = stamp_();
  rows.forEach(function (r, i) {
    Db.update(CONFIG.SHEET.HOROSCOPES, r._row, {
      content_ko: r.content_ko || items[i].content_ko || '', lucky_item: r.lucky_item || items[i].lucky_item || '',
      lucky_color: r.lucky_color || items[i].lucky_color || '', translation_status: tr.status, updated_at: now,
    });
  });
  HoroscopeRepo.invalidate(date);
  return { note: tr.note, rows: adminRows(token, date) };
}

/** 수동 입력 모드: 12별자리 빈 행을 만들어 관리자가 직접 채우게 한다 (X API·이미지 분석을 쓸 수 없을 때 대체 수단) */
function adminInitManual(token, date) {
  requireAdmin_(token);
  const mode = Settings.mode();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('날짜 형식이 올바르지 않아요.');
  if (HoroscopeRepo.rowsForDate(date, mode).length) throw new Error('이 날짜에는 이미 데이터가 있어요.');
  const now = stamp_();
  ZODIAC_KEYS.forEach(function (k) {
    Db.append(CONFIG.SHEET.HOROSCOPES, {
      id: Utilities.getUuid(), horoscope_date: date, zodiac_sign: k, rank: '', source_name: '수동 입력',
      translation_status: 'NONE', validation_status: 'INVALID', validation_note: '수동 입력 대기 중', publication_status: STATUS.REVIEW,
      data_mode: mode, edited_by_admin: 'true', created_at: now, updated_at: now,
    });
  });
  HoroscopeRepo.invalidate(date);
  return adminRows(token, date);
}

/** 설정 변경 (허용된 키만, 값 검사 후 저장) */
function adminSetSettings(token, change) {
  requireAdmin_(token);
  change = change || {};
  if (change.hasOwnProperty('AI_DAILY_LIMIT')) {
    const n = Number(change.AI_DAILY_LIMIT);
    if (!(n >= 1 && n <= 1000) || Math.floor(n) !== n) throw new Error('AI 하루 사용 한도는 1~1000 사이의 정수여야 해요.');
    Settings.set('AI_DAILY_LIMIT', n);
  }
  if (change.hasOwnProperty('GEMINI_MODEL')) {
    const m = String(change.GEMINI_MODEL || '').trim();
    if (!/^[A-Za-z0-9._-]{3,60}$/.test(m)) throw new Error('모델 이름은 영문·숫자·점·하이픈·밑줄로만 3~60자로 입력해 주세요.');
    Settings.set('GEMINI_MODEL', m);
  }
  if (change.hasOwnProperty('GEMINI_FALLBACK_MODEL')) {
    const m = String(change.GEMINI_FALLBACK_MODEL || '').trim();
    if (m && !/^[A-Za-z0-9._-]{3,60}$/.test(m)) throw new Error('예비 모델 이름은 영문·숫자·점·하이픈·밑줄로만 3~60자로 입력해 주세요. (비워 두면 사용 안 함)');
    Settings.set('GEMINI_FALLBACK_MODEL', m);
  }
  const bools = ['AUTO_PUBLISH', 'PUBLISH_REQUIRES_TRANSLATION', 'TEST_FALLBACK', 'OCR_ENABLED', 'AI_ENABLED'];
  bools.forEach(function (k) { if (change.hasOwnProperty(k)) Settings.set(k, change[k] ? 'true' : 'false'); });
  if (change.hasOwnProperty('MODE')) {
    if (['TEST', 'PRODUCTION'].indexOf(change.MODE) < 0) throw new Error('모드 값이 올바르지 않아요.');
    Settings.set('MODE', change.MODE);
  }
  if (change.hasOwnProperty('PROD_SOURCE')) {
    if (['SITE', 'X'].indexOf(change.PROD_SOURCE) < 0) throw new Error('수집 경로 값이 올바르지 않아요.');
    Settings.set('PROD_SOURCE', change.PROD_SOURCE);
  }
  if (change.hasOwnProperty('TEST_SCENARIO')) {
    if (TestFeed.scenarios.indexOf(change.TEST_SCENARIO) < 0) throw new Error('시나리오 값이 올바르지 않아요.');
    Settings.set('TEST_SCENARIO', change.TEST_SCENARIO);
  }
  if (change.hasOwnProperty('RETENTION_DAYS')) {
    const n = Number(change.RETENTION_DAYS);
    if (!(n >= 0 && n <= 3650) || Math.floor(n) !== n) throw new Error('보관 기간은 0~3650 사이의 정수여야 해요. (0 = 제한 없음)');
    Settings.set('RETENTION_DAYS', n);
  }
  if (change.hasOwnProperty('enabled')) Source.patch({ enabled: change.enabled ? 'true' : 'false' });
  if (change.hasOwnProperty('authorization_status')) {
    if (['UNVERIFIED', 'LINK_ONLY', 'APPROVED'].indexOf(change.authorization_status) < 0) throw new Error('이용 허락 상태 값이 올바르지 않아요.');
    Source.patch({ authorization_status: change.authorization_status });
  }
  const today = nowParts_().date;
  HoroscopeRepo.invalidate(today);
  return overview_();
}

function adminSetTriggers(token, on) {
  requireAdmin_(token);
  if (on) installTriggers_(); else removeTriggers_();
  return overview_();
}
