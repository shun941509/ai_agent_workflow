function filterStyleSheet(activeButtons: string) {
  return `.filter-button {
  padding: 7px 13px;
  color: #253f45;
  background: #fff;
  border: 1px solid #afc1be;
  border-radius: 6px;
}
.filter-button:hover { background: #edf5f1; }
:focus-visible { outline: 3px solid #14615d; outline-offset: 3px; }
${activeButtons} {
  color: #fff;
  background: #214e4b;
  font-weight: 700;
}`;
}

const currentPageButton = 'nav button[aria-current="page"]';
const filterStyles = filterStyleSheet(currentPageButton);

const orderControls = `<div class="toolbar">
  <div id="order-filters" class="filters" role="group" aria-label="주문 상태">
    <button class="filter-button" type="button" data-status="전체">전체</button>
    <button class="filter-button" type="button" data-status="배송 중">배송 중</button>
    <button class="filter-button" type="button" data-status="배송 완료">배송 완료</button>
  </div>
  <label>주문 검색 <input id="order-search" type="text" placeholder="주문 번호 또는 상품명"></label>
</div>`;

const returnControls = `<div class="toolbar">
  <div id="return-filters" class="filters" role="group" aria-label="반품 상태">
    <button class="filter-button" type="button" data-status="전체">전체</button>
    <button class="filter-button" type="button" data-status="접수">접수</button>
    <button class="filter-button" type="button" data-status="환불 완료">환불 완료</button>
  </div>
  <label>반품 검색 <input id="return-search" type="text" placeholder="반품 번호 또는 상품명"></label>
</div>`;

// The follow-up exercise starts at the revision cited in its two review findings.
const reviewSelection = {
  state: "\nlet markedOrderStatus = '전체';\nconst orderFilters = document.querySelectorAll('#order-filters button');",
  render: `
  for (const button of orderFilters) {
    button.setAttribute('aria-pressed', String(button.dataset.status === markedOrderStatus));
  }`,
  onClick: "\n    if (orderStatus !== '전체') markedOrderStatus = orderStatus;",
};

function orderListScript(selection?: typeof reviewSelection) {
  return `const orders = [
  ['ORD-1001', '린넨 테이블보', '배송 완료'],
  ['ORD-1002', '유리 물병', '배송 중'],
  ['ORD-1003', '나무 트레이', '배송 완료'],
];
let orderStatus = '전체';${selection?.state ?? ''}
const orderSearch = document.querySelector('#order-search');

function renderOrders() {${selection?.render ?? ''}
  const query = orderSearch.value.trim().toLowerCase();
  const visible = orders.filter(([id, product, status]) =>
    (orderStatus === '전체' || status === orderStatus) &&
    (id.toLowerCase().includes(query) || product.includes(query)));
  drawRows(document.querySelector('#order-rows'), visible);
}

${selection ? 'orderFilters' : "document.querySelectorAll('#order-filters button')"}.forEach(button => {
  button.addEventListener('click', () => {
    orderStatus = button.dataset.status;${selection?.onClick ?? ''}
    renderOrders();
  });
});
orderSearch.addEventListener('input', renderOrders);
renderOrders();`;
}

const orderScript = orderListScript();

const returnScript = `const returns = [
  ['RET-2001', '린넨 테이블보', '접수'],
  ['RET-2002', '나무 트레이', '환불 완료'],
];
let returnStatus = '전체';
const returnSearch = document.querySelector('#return-search');

function renderReturns() {
  const query = returnSearch.value.trim().toLowerCase();
  const visible = returns.filter(([id, product, status]) =>
    (returnStatus === '전체' || status === returnStatus) &&
    (id.toLowerCase().includes(query) || product.includes(query)));
  drawRows(document.querySelector('#return-rows'), visible);
}

document.querySelectorAll('#return-filters button').forEach(button => {
  button.addEventListener('click', () => {
    returnStatus = button.dataset.status;
    renderReturns();
  });
});
returnSearch.addEventListener('input', renderReturns);
renderReturns();`;

const rowScript = `function drawRows(body, records) {
  body.replaceChildren();
  for (const [id, product, status] of records) {
    const row = body.insertRow();
    row.insertCell().textContent = id;
    row.insertCell().textContent = product;
    const badge = document.createElement('span');
    badge.className = 'status';
    badge.textContent = status;
    row.insertCell().append(badge);
  }
}`;

export const orderScreenNotes = [
  '예제 파일 order-management.html을 열면 주문 목록이 보입니다. 상단의 주문 목록과 반품 목록 버튼은 현재 화면을 진한 녹색으로 표시합니다.',
  '주문 3건 중 배송 중을 누르면 유리 물병(ORD-1002) 한 건이 남습니다. 반품 목록에서 접수를 누르면 두 건 중 린넨 테이블보(RET-2001) 한 건이 남습니다. 환불 완료는 나무 트레이(RET-2002)입니다.',
  '두 화면 모두 상태 버튼에서 포커스를 옮기면 선택한 버튼의 모양이 다른 상태 버튼과 같습니다. 상태 버튼은 Tab과 Enter 또는 Space로 조작할 수 있습니다.',
  '주문 검색이나 반품 검색에 없는상품을 입력하면 표 머리글만 남습니다. 검색 결과 안내와 조건 초기화 버튼은 없습니다. 검색어를 지우면 현재 상태의 행이, 전체를 누르면 해당 목록의 모든 행이 다시 보입니다.',
].join('\n');

function sourceExcerpt(controls: string, script: string) {
  return ['order-management.html · 필터와 목록 원문 발췌', controls, filterStyles, script, rowScript].join('\n\n');
}

// The runnable page and the documents in the workflows share these exact source fragments.
export const orderFilterSource = sourceExcerpt(orderControls, orderScript);
export const returnFilterSource = sourceExcerpt(returnControls, returnScript);

function orderManagementPage(styles: string, orders: string) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>주문·반품 관리</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #f3f6f3;
  color: #203631;
  font-family: "Source Sans 3", "Malgun Gothic", sans-serif;
  line-height: 1.55;
}
header { background: #fff; border-bottom: 1px solid #cdd9d3; }
.header-inner, main { width: min(100% - 48px, 1060px); margin: 0 auto; }
.header-inner { min-height: 74px; display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; padding: 14px 0; }
.brand { font-size: 17px; font-weight: 700; }
nav, .filters { display: flex; flex-wrap: wrap; gap: 6px; }
button, input { font: inherit; font-size: 14px; }
button { cursor: pointer; }
nav button { color: #29483e; background: #eff4ef; border: 0; border-radius: 7px; padding: 8px 14px; }
main { padding: 44px 0; }
h1 { margin: 0 0 20px; font-size: 30px; letter-spacing: -.03em; }
.surface { background: #fff; border: 1px solid #cbd8d2; border-radius: 10px; overflow: hidden; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 20px; }
label { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 9px; font-size: 14px; font-weight: 600; }
input { max-width: 100%; padding: 7px 10px; color: #203631; border: 1px solid #afc1be; border-radius: 6px; }
input::placeholder { color: #5c6f69; }
${styles}
.table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 27rem; border-collapse: collapse; text-align: left; }
th, td { padding: 13px 20px; border-top: 1px solid #dae3dd; }
th { font-size: 13px; color: #47615a; background: #f4f7f4; }
td:first-child { font-variant-numeric: tabular-nums; }
.status { display: inline-block; border-radius: 4px; padding: 3px 8px; background: #eaf2ee; color: #2b5145; font-size: 13px; }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <span class="brand">주문·반품 관리</span>
    <nav aria-label="관리 화면">
      <button type="button" data-screen="orders" aria-current="page">주문 목록</button>
      <button type="button" data-screen="returns">반품 목록</button>
    </nav>
  </div>
</header>
<main>
  <section id="orders" aria-labelledby="orders-title">
    <h1 id="orders-title">주문 목록</h1>
    <div class="surface">
      ${orderControls}
      <div class="table-scroll" role="region" aria-label="주문 표 스크롤" tabindex="0">
        <table aria-label="주문 내역">
          <thead><tr><th scope="col">주문 번호</th><th scope="col">상품명</th><th scope="col">주문 상태</th></tr></thead>
          <tbody id="order-rows"></tbody>
        </table>
      </div>
    </div>
  </section>
  <section id="returns" aria-labelledby="returns-title" hidden>
    <h1 id="returns-title">반품 목록</h1>
    <div class="surface">
      ${returnControls}
      <div class="table-scroll" role="region" aria-label="반품 표 스크롤" tabindex="0">
        <table aria-label="반품 내역">
          <thead><tr><th scope="col">반품 번호</th><th scope="col">상품명</th><th scope="col">반품 상태</th></tr></thead>
          <tbody id="return-rows"></tbody>
        </table>
      </div>
    </div>
  </section>
</main>
<script>
${rowScript}

${orders}

${returnScript}

const navigation = document.querySelectorAll('nav [data-screen]');
for (const button of navigation) {
  button.addEventListener('click', () => {
    for (const item of navigation) {
      const active = item === button;
      document.getElementById(item.dataset.screen).hidden = !active;
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  });
}
</script>
</body>
</html>
`;
}

export const orderManagementHtml = orderManagementPage(filterStyles, orderScript);
export const reviewFollowupHtml = orderManagementPage(
  filterStyleSheet(currentPageButton + ', #order-filters button[aria-pressed="true"]'),
  orderListScript(reviewSelection),
);
