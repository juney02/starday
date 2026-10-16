/**
 * 개발 도구 (소유자가 편집기에서 직접 실행)
 *
 * moveSheetToFolder(): 이 스크립트가 붙어 있는 스프레드시트를
 *   구글 드라이브의 "부트캠프 중급 / 5.부트캠프" 폴더 안으로 옮긴다.
 *   (시트에 연결된 스크립트는 시트와 함께 움직이므로 따로 옮길 필요가 없다)
 *   폴더를 하나로 정할 수 없거나 없으면 아무것도 옮기지 않고 이유를 로그로 알려 준다.
 */
function moveSheetToFolder() {
  requireOwner_();
  const PARENT_NAME = '부트캠프 중급', FOLDER_NAME = '5.부트캠프';

  const matches = [];
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  while (it.hasNext()) {
    const f = it.next(), ps = f.getParents();
    let underParent = false;
    while (ps.hasNext()) { if (ps.next().getName() === PARENT_NAME) underParent = true; }
    if (underParent) matches.push(f);
  }
  if (matches.length !== 1) {
    Logger.log('"' + PARENT_NAME + '" 안의 "' + FOLDER_NAME + '" 폴더를 ' + (matches.length ? '여러 개' : '찾지 못했어요') + ' (' + matches.length + '개). 아무것도 옮기지 않았어요.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  file.moveTo(matches[0]);
  Logger.log('옮겼어요: "' + ss.getName() + '" → ' + matches[0].getUrl());
}
