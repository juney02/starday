/**
 * 처음 설정 / 시트 메뉴 (소유자 전용)
 *
 * 구글 시트를 열면 위쪽에 "⭐ 별하루" 메뉴가 생긴다.
 *   1. 실제 운세로 시작하기  → setupRealApp()   : DB 탭·실제 운세 모드·자동 확인 트리거를 한 번에 준비하고 오늘 운세를 바로 가져온다
 *   2. AI 키 등록하기        → menuGeminiKey()  : Gemini 키를 입력받아 스크립트 속성에만 저장하고, 쓸 수 있는 모델을 자동으로 맞춘다
 *   3. 지금 운세 가져오기    → menuFetchNow()
 *   4. 지금 상태 보기        → menuStatus()     : 모드·이용 허락·트리거·AI 상태 (비밀 값은 "등록됨/없음"만)
 *
 * 개인 열람 전용 원칙
 *  - 실제 운세 모드는 "나 혼자 보는 용도"를 전제로 한다. 웹앱 접근은 '나만'(appsscript.json access: MYSELF)을 유지한다.
 *  - 이용 허락 상태를 APPROVED로 두는 것은 "내 화면에 내용을 표시한다"는 뜻이지, 공개 배포 허락을 받았다는 뜻이 아니다.
 *    다른 사람에게 공개하려면 먼저 ABC TV의 이용 허락을 받아야 한다.
 */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('⭐ 별하루')
      .addItem('1. 실제 운세로 시작하기 (처음 한 번)', 'setupRealApp')
      .addItem('2. AI 키 등록하기', 'menuGeminiKey')
      .addSeparator()
      .addItem('3. 지금 운세 가져오기', 'menuFetchNow')
      .addItem('4. 지금 상태 보기', 'menuStatus')
      .addToUi();
  } catch (e) { /* 시트 화면이 아닌 곳(웹앱 등)에서 불리면 무시 */ }
}

/**
 * 앱(웹앱)이 데이터를 처음 요청할 때 한 번만: 메뉴를 누르지 않았어도 실제 운세 모드로 맞춘다.
 * SETUP_REAL=1 이 기록되면 다시 하지 않는다. (그 뒤 관리자가 TEST로 바꾸면 그 선택을 존중한다)
 */
function ensureRealSetup_() {
  if (Settings.get('SETUP_REAL', '') === '1') return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    if (Settings.get('SETUP_REAL', '') === '1') return;
    applyRealSettings_();
    try { if (!triggersInstalled_()) installTriggers_(); } catch (e) { /* 트리거를 못 만들어도 "앱을 열 때 바로 확인"으로 동작 */ }
    Settings.set('SETUP_REAL', '1');
  } finally { lock.releaseLock(); }
}

/** 실제 운세 모드 설정값 (메뉴 1번과 자동 설정이 함께 쓴다) */
function applyRealSettings_() {
  Object.keys(TABLES).forEach(function (n) { Db.sheet(n); });
  Source.get();
  Settings.set('MODE', 'PRODUCTION');                 // 가상(TEST) → 실제 운세
  Settings.set('PROD_SOURCE', 'SITE');                // 공식 사이트 horoscope.json (X API 비용 없음)
  Settings.set('AUTO_PUBLISH', 'true');               // 12별자리·순위·날짜 검증을 통과하면 바로 화면에 표시
  Settings.set('PUBLISH_REQUIRES_TRANSLATION', 'false'); // 번역이 실패해도 일본어 원문으로라도 보여준다
  Settings.set('ON_DEMAND_FETCH', 'true');            // 앱을 열었을 때 오늘 운세가 없으면 바로 확인
  Source.patch({
    enabled: 'true', authorization_status: 'APPROVED',
    notes: '2026-10-17 소유자 결정: 링크가 있는 누구나 볼 수 있게 공개(ABC TV 이용 허락은 미확인, 위험을 알고 선택). 허락 문제가 생기면 LINK_ONLY로 바꿀 것.',
  });
  if (!Settings.has('ADMIN_TOKEN')) Settings.set('ADMIN_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  HoroscopeRepo.invalidate(nowParts_().date);
}

/** 편집기 또는 시트 메뉴에서 실행: 실제 운세 모드로 한 번에 설정 */
function setupRealApp() {
  requireOwner_();
  applyRealSettings_();
  Settings.set('SETUP_REAL', '1');
  installTriggers_();

  const r = Importer.run('SETUP', {});
  const lines = [
    '실제 운세 모드로 설정했어요.',
    '- 운세 출처: 오하아사 공식 사이트 (매일 08:00~09:00 자동 확인 + 앱을 열 때 없으면 바로 확인)',
    '- 오늘 운세 가져오기 결과: ' + r.status + ' / ' + (r.message || ''),
    '- 관리자 토큰: 등록됨 (보려면 편집기에서 setupAdminToken 실행)',
    '- AI 도우미: ' + (Settings.has('GEMINI_API_KEY') ? '키 등록됨' : '키 없음 → 메뉴 "2. AI 키 등록하기"'),
    '',
    '다음 단계: 편집기 오른쪽 위 [배포] → [새 배포] → 웹 앱(액세스: 나만) → 나온 주소를 폰·PC에서 열기',
  ];
  notify_('별하루 설정 완료', lines.join('\n'));
  return lines.join('\n');
}

/** 시트 메뉴: Gemini 키를 입력받아 스크립트 속성에만 저장 (코드·시트 칸에는 남기지 않는다) */
function menuGeminiKey() {
  requireOwner_();
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('AI 키 등록', 'Google AI Studio에서 받은 Gemini API 키를 붙여 넣어 주세요.\n(이 키는 스크립트 속성에만 저장돼요. 다른 사람에게 보여주지 마세요)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = String(res.getResponseText() || '').trim();
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(key)) { ui.alert('키 모양이 이상해요. 다시 복사해서 붙여 넣어 주세요.'); return; }
  Settings.set('GEMINI_API_KEY', key);
  ui.alert('AI 키 등록', 'AI 키를 저장했어요.\n' + aiAutoConfigure_(), ui.ButtonSet.OK);
}

/**
 * 이 키로 실제로 쓸 수 있는 모델 목록을 확인해서
 *  - 지금 설정된 기본 모델이 없으면 쓸 수 있는 flash 모델로 바꾸고
 *  - 붐빌 때 넘어갈 예비 모델도 정한다.
 * @return {string} 결과 설명 (키는 포함하지 않음)
 */
function aiAutoConfigure_() {
  const key = Settings.get('GEMINI_API_KEY', '');
  if (!key) return 'AI 키가 없어요.';
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return '모델 목록을 확인하지 못했어요 (HTTP ' + r.getResponseCode() + '). 키가 맞는지 확인해 주세요.';
  const names = (JSON.parse(r.getContentText()).models || [])
    .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (m) { return String(m.name).replace('models/', ''); });
  let model = Settings.get('GEMINI_MODEL', AI_DEFAULT_MODEL);
  const notes = [];
  if (names.indexOf(model) < 0) {
    const pick = pickFallbackModel_(names, '');
    if (!pick) return '쓸 수 있는 Gemini 모델을 찾지 못했어요.';
    notes.push('기본 모델 "' + model + '"은 이 키로 쓸 수 없어서 "' + pick + '"(으)로 바꿨어요.');
    model = pick; Settings.set('GEMINI_MODEL', pick);
  } else notes.push('기본 모델: ' + model);
  const fb = pickFallbackModel_(names, model);
  if (fb) { Settings.set('GEMINI_FALLBACK_MODEL', fb); notes.push('예비 모델: ' + fb); }
  return notes.join('\n');
}

/** 시트 메뉴: 지금 바로 공식 사이트에서 오늘 운세 확인 */
function menuFetchNow() {
  requireOwner_();
  const r = Importer.run('MANUAL', {});
  notify_('지금 운세 가져오기', r.status + '\n' + (r.message || ''));
}

/** 시트 메뉴: 지금 상태 (비밀 값은 등록 여부만) */
function menuStatus() {
  requireOwner_();
  const today = nowParts_().date;
  const res = HoroscopeService.getByDate(today);
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  const lines = [
    '모드: ' + Settings.mode() + (Settings.mode() === 'TEST' ? ' (가상 운세 — 메뉴 1번을 실행하세요)' : ' (실제 운세)'),
    '이용 허락 상태: ' + Source.authorization(),
    '자동 확인 트리거: ' + (triggersInstalled_() ? '켜짐' : '꺼짐'),
    '오늘(' + today + ') 화면 상태: ' + res.status + (res.items && res.items.length ? ' (12별자리 표시 중)' : ' / ' + (res.message || '')),
    '공식 사이트 최신 자료 날짜: ' + Settings.get('SITE_LATEST_DATE', '아직 확인 전'),
    'AI 키: ' + (Settings.has('GEMINI_API_KEY') ? '등록됨' : '없음') + ' / 모델: ' + Settings.get('GEMINI_MODEL', AI_DEFAULT_MODEL),
    'AI 마지막 오류: ' + Settings.get('AI_LAST_ERROR', '없음'),
    '웹앱 주소: ' + (url || '아직 배포 전'),
  ];
  notify_('별하루 상태', lines.join('\n'));
}

/** 시트 화면이면 알림창, 편집기 실행이면 로그 */
function notify_(title, text) {
  Logger.log(title + '\n' + text);
  try { SpreadsheetApp.getUi().alert(title, text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* 편집기에서 실행하면 알림창 없이 로그만 */ }
}
