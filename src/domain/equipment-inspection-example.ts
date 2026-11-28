import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// The web example embeds exactly the module used by the exported local HTTP receiver.
export const inspectionReceiverModule = readFileSync(join(process.cwd(),'src/domain/inspection-receiver.mjs'),'utf8');
export const inspectionExampleHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>장비 반납 목록 · 검수 알림 실습</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f3f4ed;color:#1c2b25;font:16px/1.55 "Malgun Gothic","맑은 고딕",sans-serif;word-break:keep-all;overflow-wrap:anywhere}
  main{width:min(1320px,100%);margin:auto;padding:clamp(20px,4vw,64px)}
  header{border-top:7px solid #234c3a;padding:28px 0 26px;border-bottom:1px solid #9fa99f}
  h1,h2,p{margin:0}
  h1{font-size:clamp(30px,3.3vw,48px);line-height:1.2;letter-spacing:-.055em}
  header p{margin-top:10px;color:#45564e}
  h2{font-size:22px;line-height:1.35;letter-spacing:-.035em}
  .workbench{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,1fr);gap:clamp(20px,4vw,56px);margin-top:30px}
  .pane{min-width:0}
  .heading{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .inventory-count,.note{color:#4f5f54;font-size:14px}
  .scroll{overflow-x:auto;background:#fff;border:1px solid #bfc8bc}
  table{border-collapse:collapse;width:100%;min-width:380px;text-align:left;font-size:15px}
  th{color:#46554b;background:#ebeee6}
  td,th{padding:12px 14px;border-bottom:1px solid #d8ded4;white-space:nowrap}
  tbody tr:last-child td{border-bottom:0}
  tr.selected{background:#eef7df}
  button,textarea{font:inherit}
  button{cursor:pointer}
  .equipment-id{font:700 15px/1.4 Consolas,monospace;letter-spacing:.01em;color:#194d32;text-decoration:underline;text-underline-offset:4px;border:0;background:transparent;padding:3px 0}
  .inspection{display:inline-block;padding:2px 8px;border:1px solid #bcc7b7;border-radius:4px;font-weight:700;font-size:13px;background:#f6f7f1;color:#435044}
  .inspection.done{background:#e1f0d8;color:#254c2f;border-color:#a8c79a}
  .history{margin-top:32px}
  .history table{min-width:320px}
  .empty{padding:9px 0;color:#516055;font-size:14px}
  .editor{padding:20px;border:1px solid #bfc8bc;border-top:4px solid #234c3a;background:#fff}
  label{font-weight:700;display:block}
  textarea{width:100%;border:1px solid #a6b2a6;border-radius:2px;display:block;padding:10px;color:#1a3325;background:#fafcf8;resize:vertical;font:14px/1.55 Consolas,"Malgun Gothic",monospace}
  .editor textarea{margin:6px 0 12px;min-height:132px}
  .actions{display:flex;flex-wrap:wrap;gap:8px}
  .primary,.secondary{border:1px solid #234c3a;color:white;background:#234c3a;padding:8px 15px;min-height:38px;border-radius:3px;font-weight:700}
  .secondary{background:#fff;color:#294335;border-color:#a6b2a6}
  .primary:hover{background:#153827}.secondary:hover{background:#f1f6eb}
  :focus-visible{outline:3px solid #00649b;outline-offset:3px}
  #feedback{margin-top:15px;color:#2c4735;font-weight:700}
  #feedback[data-error=true]{color:#962f20}
  .results{margin:28px 0 0;padding:22px 0;border-top:1px solid #9fa99f}
  .results h2{margin-bottom:6px}
  #summary{font-weight:700;margin-bottom:10px}
  .results details{margin-top:12px}
  .results summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px;display:list-item;width:fit-content;color:#294d3b;font-weight:700}
  .results textarea{min-height:90px;background:white;margin:7px 0 10px}
  .detail-meta{margin:-3px 0 10px;color:#45564e;font-size:14px}
  @media(max-width:900px){.workbench{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:530px){main{padding:14px}.editor{padding:14px}td,th{padding:10px}}
</style>
</head>
<body>
<main>
  <header><h1>장비 반납 목록</h1><p>같은 검수 완료 알림을 두 번 입력한 뒤 장비의 검수 상태와 재대여 승인, 처리 이력을 대조하세요.</p></header>
  <div class="workbench">
    <div class="pane">
      <section aria-labelledby="inventory-title">
        <div class="heading"><h2 id="inventory-title">반납 장비</h2><span class="inventory-count">3대</span></div>
        <div class="scroll" tabindex="0" role="region" aria-label="반납 장비 표 영역"><table aria-labelledby="inventory-title">
          <thead><tr><th scope="col">장비 번호</th><th scope="col">품명</th><th scope="col">검수 상태</th><th scope="col">재대여 승인</th></tr></thead><tbody id="inventory"></tbody>
        </table></div>
      </section>
      <section class="history" aria-labelledby="history-title">
        <div class="heading"><h2 id="history-title">처리 이력</h2><span id="selected-count" class="inventory-count"></span></div>
        <p class="detail-meta" id="detail"></p>
        <div class="scroll" tabindex="0" role="region" aria-label="선택한 장비의 처리 이력 표 영역"><table aria-labelledby="history-title">
          <thead><tr><th scope="col">알림 ID</th><th scope="col">처리 내용</th></tr></thead><tbody id="history"></tbody>
        </table></div>
        <p class="empty" id="empty">이 장비의 처리 이력이 없습니다.</p>
      </section>
    </div>
    <section class="editor" aria-labelledby="input-title">
      <div class="heading"><h2 id="input-title">알림 입력 실습</h2></div>
      <p class="note" id="event-help">기본 알림은 A-17에 도착합니다. B-08로 바꿔 연습할 때는 실습을 초기화하세요.</p>
      <form id="delivery-form">
        <label for="event">검수 알림</label><textarea id="event" rows="5" spellcheck="false" aria-describedby="event-help" required></textarea>
        <div class="actions"><button class="primary" type="submit">알림 입력</button><button class="secondary" id="reset" type="button">실습 초기화</button></div>
      </form>
      <p id="feedback" role="status" aria-live="polite"></p>
    </section>
  </div>
  <section class="results" aria-labelledby="verify-title">
    <h2 id="verify-title">검증 결과</h2><p id="summary"></p><p class="note" id="counts"></p>
    <details id="receipt-panel"><summary>검증 기록 보기</summary><label for="receipt">검증 기록</label>
      <textarea id="receipt" rows="4" readonly spellcheck="false"></textarea>
      <button type="button" class="secondary" id="copy">검증 기록 복사</button>
      <span id="copy-note" class="note" aria-live="polite"></span>
    </details>
  </section>
</main>
<script type="module">
${inspectionReceiverModule}
let session;
let selected;
const element = id => document.getElementById(id);
function readEvent() {
  try { return JSON.parse(element('event').value); }
  catch { throw new Error('JSON 형식을 확인하세요. 키와 문자열에는 큰따옴표를 사용하세요.'); }
}
function setFeedback(message, error = false) {
  element('feedback').textContent = message;
  element('feedback').dataset.error = String(error);
}
function paintSelection() {
  const item = session.equipment.find(row => row.equipmentId === selected);
  for (const button of element('inventory').querySelectorAll('button')) {
    const active = button.textContent === selected;
    button.setAttribute('aria-pressed',String(active));
    button.closest('tr').classList.toggle('selected',active);
  }
  const entries = session.history.filter(entry => entry.equipmentId === selected);
  element('detail').textContent = selected + ' · ' + item.name;
  element('selected-count').textContent = entries.length + '건';
  element('empty').hidden = entries.length > 0;
  const body = element('history');
  body.replaceChildren();
  for (const entry of entries) {
    const row = body.insertRow();
    row.insertCell().textContent = entry.eventId;
    row.insertCell().textContent = '검수 완료 반영';
  }
}
function render() {
  const body = element('inventory');
  body.replaceChildren();
  for (const item of session.equipment) {
    const row = body.insertRow();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'equipment-id';
    button.textContent = item.equipmentId;
    button.addEventListener('click', () => { selected = item.equipmentId; paintSelection(); });
    row.insertCell().append(button);
    row.insertCell().textContent = item.name;
    const status = document.createElement('span');
    status.className = 'inspection' + (item.inspectionStatus === '검수 완료' ? ' done' : '');
    status.textContent = item.inspectionStatus;
    row.insertCell().append(status);
    row.insertCell().textContent = item.rentalApproval;
  }
  paintSelection();
  const report = makeInspectionReceipt(session);
  element('receipt').value = JSON.stringify(report,null,2);
  element('counts').textContent = '접수한 알림 ' + report.deliveries.length + '회 · 전체 처리 이력 ' + report.history.length + '건';
  element('summary').textContent = report.verified
    ? '검증 통과 · ' + report.deliveries[0].equipmentId + '의 검수 상태만 바뀌었고, 재대여 승인은 그대로이며 처리 이력은 한 건입니다.'
    : (report.deliveries.length < 2 ? '같은 알림을 두 번 입력하면 검증 결과가 표시됩니다.' : '조건을 다시 확인하세요. 실습 초기화 후 검수 대기 장비에 같은 알림을 두 번 입력하세요.');
}
function reset() {
  session = createInspectionSession();
  selected = defaultInspectionEvent.equipmentId;
  element('event').value = JSON.stringify(defaultInspectionEvent,null,2);
  element('copy-note').textContent = '';
  setFeedback('');
  render();
}
element('delivery-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const input = readEvent();
    const result = applyInspectionDelivery(session,input);
    selected = input.equipmentId;
    setFeedback(result === 'duplicate' ? '중복 알림 · 기존 처리 이력을 유지했습니다.' : selected + '의 검수 완료 알림을 반영했습니다.');
    render();
  } catch (error) { setFeedback(error.message,true); }
});
element('reset').addEventListener('click',() => { reset(); setFeedback('초기 상태로 돌아왔습니다.'); });
element('copy').addEventListener('click', async () => {
  const box = element('receipt');
  try {
    await navigator.clipboard.writeText(box.value);
    element('copy-note').textContent = '검증 기록을 복사했습니다.';
  } catch {
    box.focus();
    box.select();
    element('copy-note').textContent = '선택한 검증 기록을 Ctrl+C로 복사하세요.';
  }
});
reset();
</script>
</body>
</html>`;
