const STORE='allegraGestaoPro.v1';
const PRODUCTION_STAGES=['Criação de Arte','Em Produção','Finalizado','Entregue'];
const today=()=>new Date().toISOString().slice(0,10);
const money=n=>(Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const roundQty=n=>Math.max(0,Math.round((Number(n)||0)*1000)/1000);
const roundCost=n=>Math.max(0,Math.round((Number(n)||0)*10000)/10000);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
function normalizeStage(v){const raw=String(v||'').trim();if(PRODUCTION_STAGES.includes(raw))return raw;const f=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(f.includes('producao')||f.includes('produzindo'))return 'Em Produção';if(f.includes('finaliz')||f.includes('pronto'))return 'Finalizado';if(f.includes('entreg'))return 'Entregue';return 'Criação de Arte'}
const defaultState={clients:[],stock:[],purchases:[],expenses:[],quotes:[],orders:[],sales:[],models:[],settings:{business:'Allegra gráfica & personalizados',phone:'',address:'',lowStock:5}};
let state=load();let page='dashboard';let authToken=sessionStorage.getItem('allegraToken')||null;let saveTimer=null;let saveQueue=Promise.resolve();let persistedState=null;let purchaseQuickRow='';let quoteClientShortcut='';let dashRange={from:new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10),to:today()};
function load(){try{return {...defaultState,...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{return structuredClone(defaultState)}}
function persistLocal(){try{localStorage.setItem(STORE,JSON.stringify(state))}catch{}}
async function api(path,options={}){const headers={...(options.headers||{}),'Content-Type':'application/json'};if(authToken)headers.Authorization='Bearer '+authToken;const r=await fetch('/api'+path,{...options,headers});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||'Falha na comunicação com o servidor');return data}
function stateChanges(before,after){const changes={},collections=['clients','stock','purchases','expenses','quotes','orders','sales','models'];for(const key of collections){const oldRows=before?.[key]||[],newRows=after[key]||[],oldById=new Map(oldRows.map(x=>[String(x.id),x])),newById=new Map(newRows.map(x=>[String(x.id),x])),upsert=newRows.filter(x=>!oldById.has(String(x.id))||JSON.stringify(oldById.get(String(x.id)))!==JSON.stringify(x)),del=oldRows.filter(x=>!newById.has(String(x.id))).map(x=>String(x.id));if(upsert.length||del.length)changes[key]={upsert,delete:del}}if(JSON.stringify(before?.settings||{})!==JSON.stringify(after.settings||{}))changes.settings=after.settings||{};return changes}
function hasChanges(changes){return Object.keys(changes).length>0}
function performSync(){const snapshot=structuredClone(state);saveQueue=saveQueue.then(async()=>{const changes=stateChanges(persistedState||defaultState,snapshot);if(!hasChanges(changes))return;await api('/sync',{method:'PATCH',body:JSON.stringify({changes})});persistedState=snapshot;if(JSON.stringify(state)!==JSON.stringify(snapshot))save(true)}).catch(e=>toast('Falha ao salvar no servidor: '+e.message));return saveQueue}
function save(immediate=false){persistLocal();if(!authToken)return Promise.resolve();clearTimeout(saveTimer);if(immediate)return performSync();saveTimer=setTimeout(()=>{performSync()},350);return saveQueue}
async function flushSave(){clearTimeout(saveTimer);return performSync()}
async function moveOrderStage(id,delta){const o=state.orders.find(x=>x.id===id);if(!o)return;const current=normalizeStage(o.stage),curIdx=PRODUCTION_STAGES.indexOf(current),nextIdx=Math.min(PRODUCTION_STAGES.length-1,Math.max(0,(curIdx===-1?0:curIdx)+delta)),nextStageName=PRODUCTION_STAGES[nextIdx];if(o.stage===nextStageName)return;const prevStageName=o.stage;o.stage=nextStageName;persistLocal();render();if(!authToken)return;clearTimeout(saveTimer);saveQueue=saveQueue.then(async()=>{await api(`/orders/${encodeURIComponent(o.id)}/stage`,{method:'PATCH',body:JSON.stringify({stage:nextStageName,order:o})});if(persistedState?.orders){const po=persistedState.orders.find(x=>String(x.id)===String(o.id));if(po)po.stage=nextStageName;else persistedState.orders.push(structuredClone(o))}const remaining=stateChanges(persistedState||defaultState,structuredClone(state));if(hasChanges(remaining)){await api('/sync',{method:'PATCH',body:JSON.stringify({changes:remaining})});persistedState=structuredClone(state)}toast(`Status salvo no banco: ${nextStageName}`)}).catch(async err=>{try{const snapshot=structuredClone(state),changes=stateChanges(persistedState||defaultState,snapshot);if(hasChanges(changes)){await api('/sync',{method:'PATCH',body:JSON.stringify({changes})});persistedState=snapshot;toast(`Status salvo no banco: ${nextStageName}`);return}}catch(syncErr){o.stage=prevStageName;persistLocal();render();toast('Falha ao persistir status do pedido: '+(syncErr.message||err.message))}})}
function showLogin(message=''){document.querySelector('.app-shell').style.display='none';let box=document.querySelector('#authGate');box.style.display='grid';box.innerHTML=`<section class="auth-card"><div class="brand-mark auth-logo">Allegra<small>GRÁFICA</small></div><h1>Allegra Gestão Pro</h1><p>Acesso privado da administradora · Rede interna</p><form id="loginForm"><div class="field"><label>Usuário</label><input name="username" required autocomplete="username" placeholder="Usuário da administradora"></div><div class="field"><label>Senha</label><input name="password" type="password" required autocomplete="current-password" placeholder="Sua senha"></div><button class="btn primary" style="width:100%;margin-top:16px">Entrar</button><p class="auth-error">${esc(message)}</p></form><small>Disponível somente na rede Wi-Fi autorizada.</small></section>`;document.querySelector('#loginForm').onsubmit=async e=>{e.preventDefault();const d=formData(e.currentTarget);try{const result=await api('/login',{method:'POST',body:JSON.stringify(d)});authToken=result.token;sessionStorage.setItem('allegraToken',authToken);await startIntranet();}catch(err){showLogin('Não foi possível entrar. Confira usuário e senha.')}};}
async function startIntranet(){try{const data=await api('/state'),payload=data.payload||{};state={...defaultState,...payload,clients:(payload.clients||[]).map(c=>({...c,birth:normalizedBirth(c.birth)||''})),orders:(payload.orders||[]).map(o=>({...o,stage:normalizeStage(o.stage),orderDate:normalizedBirth(o.orderDate||o.date)||today(),date:normalizedBirth(o.orderDate||o.date)||today(),due:normalizedBirth(o.due)||''})),settings:{...defaultState.settings,...(payload.settings||{})}};persistedState=structuredClone(state);persistLocal();document.querySelector('#authGate').style.display='none';document.querySelector('.app-shell').style.display='flex';render();}catch(e){authToken=null;sessionStorage.removeItem('allegraToken');showLogin('Não foi possível carregar os dados do servidor. '+e.message);}}
async function initIntranet(){if(!authToken){showLogin();return}await startIntranet();}
async function signOut(){authToken=null;sessionStorage.removeItem('allegraToken');showLogin('Você saiu do sistema.');}
function toast(s){let t=document.querySelector('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
function dateBR(s){if(!s)return '—';let value=String(s),d=/^\d{4}-\d{2}-\d{2}/.test(value)?new Date(`${value.slice(0,10)}T12:00:00`):new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR')}
function setPage(p){page=p;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===p));render();document.querySelector('.sidebar').classList.remove('open')}
document.querySelector('#nav').addEventListener('click',e=>{let b=e.target.closest('[data-page]');if(b)setPage(b.dataset.page)});
document.querySelector('#menuToggle').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');
function head(title,sub,extra=''){return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`}
function panel(title,body,cls=''){return `<section class="panel ${cls}"><h2>${title}</h2>${body}</section>`}
function stat(label,value,desc,cl=''){return `<div class="stat"><label>${label}</label><strong class="${cl}">${value}</strong><small>${desc}</small></div>`}
function field(label,name,type='text',placeholder='',value='',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" placeholder="${placeholder}" value="${esc(value)}" ${extra}></div>`}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function render(){let el=document.querySelector('#pageContent');el.innerHTML=({dashboard:dashboardPage,production:productionPage,quotes:quotesPage,clients:clientsPage,stock:stockPage,expenses:expensesPage,settings:settingsPage}[page])();wireCommon();if(page==='quotes')recalcQuote()}
function wireCommon(){document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action,b.dataset.id,b.dataset.value)))}
function dashboardPage(){
 const sales=state.sales.filter(s=>(!dashRange.from||s.date>=dashRange.from)&&(!dashRange.to||s.date<=dashRange.to));
 const purchases=(state.purchases||[]).filter(p=>(!dashRange.from||p.date>=dashRange.from)&&(!dashRange.to||p.date<=dashRange.to));
 const total=sales.reduce((a,s)=>a+Number(s.total),0),cost=sales.reduce((a,s)=>a+Number(s.cost||0),0),profit=total-cost,periodPurchases=purchases.reduce((a,p)=>a+Number(p.total||0),0);
 const stockValue=state.stock.reduce((a,s)=>a+Number(s.qty)*Number(s.unitCost),0),received=state.orders.reduce((a,o)=>a+Math.max(0,Number(o.total)-Number(o.paid||0)),0);
 const productTotals={};for(const sale of sales){const lines=sale.items?.length?sale.items:[{name:sale.product,qty:sale.qty,total:sale.total}];for(const line of lines){const name=line.name||sale.product||'Produto',key=name.toLocaleLowerCase('pt-BR'),qty=Number(line.qty)||1,total=Number(line.total??(qty*Number(line.unitPrice||0)))||0;productTotals[key]??={name,qty:0,total:0};productTotals[key].qty+=qty;productTotals[key].total+=total}}
 const products=Object.values(productTotals).sort((a,b)=>b.qty-a.qty||b.total-a.total).slice(0,5);
 const clients=Object.values(sales.reduce((acc,s)=>{let k=s.clientName||'Cliente avulso';acc[k]??={name:k,orders:0,total:0};acc[k].orders++;acc[k].total+=Number(s.total)||0;return acc},{})).sort((a,b)=>b.total-a.total).slice(0,5);
 return `${head('Dashboard Financeiro & Vendas','Consulte o faturamento, as compras e o desempenho das vendas.',`<div class="filters no-print"><div class="field"><label>De:</label><input id="dashFrom" type="date" value="${dashRange.from}"></div><div class="field"><label>Até:</label><input id="dashTo" type="date" value="${dashRange.to}"></div><button class="btn light" data-action="filterDash">Consultar</button><button class="btn primary" onclick="window.print()">▣ Imprimir relatório</button></div>`)}
 <div class="grid stats dashboard-stats">${stat('Faturamento',money(total),'Vendas confirmadas no período')}${stat('Lucro bruto estimado',money(profit),total?((profit/total)*100).toFixed(1)+'% sobre vendas':'Sem vendas','green')}${stat('Compras de insumos',money(periodPurchases),'Compras no período','purple')}${stat('Vendas confirmadas',sales.length,'Pedidos no período')}${stat('Patrimônio em insumos',money(stockValue),'Valor estimado do estoque','purple')}</div>
 <div class="receive"><b>A RECEBER DAS ENCOMENDAS</b><div class="muted">Saldo pendente dos pedidos em produção</div><strong>${money(received)}</strong></div>
 <div class="grid two-col">${panel('Produtos mais vendidos',products.length?`<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Unidades</th><th>Faturamento</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ainda não há vendas no período.</div>')}${panel('Top clientes',clients.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Pedidos</th><th>Total comprado</th></tr></thead><tbody>${clients.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.orders}</td><td>${money(c.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Ainda não há vendas no período.</div>')}</div>
 <div style="height:18px"></div>${panel('Histórico de Vendas Confirmadas',sales.length?`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Produto / itens</th><th>Pagamento</th><th>Qtd.</th><th>Valor</th><th>Recibo</th></tr></thead><tbody>${sales.slice().reverse().map(s=>`<tr><td>${dateBR(s.date)}</td><td>${esc(s.clientName)}</td><td>${s.items?.length?s.items.map(i=>`${esc(i.qty)}× ${esc(i.name)}`).join('<br>'):esc(s.product)}</td><td>${esc(s.payment)}</td><td>${s.qty}</td><td>${money(s.total)}</td><td><button class="btn small light" data-action="receipt" data-id="${s.id}">Ver recibo</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhuma venda confirmada neste período. Lance uma venda pela Calculadora & Orçamentos.</div>')}`;
}
function productionPage(){
 const stages=[{name:'Criação de Arte',icon:'🎨'},{name:'Em Produção',icon:'🖨️'},{name:'Finalizado',icon:'✨'},{name:'Entregue',icon:'📦'}],deliveries=[{value:'Loja',icon:'🏬'},{value:'MotoUber',icon:'🛵'},{value:'Correios',icon:'🚚'}];
 state.orders.forEach(o=>{o.stage=normalizeStage(o.stage)});
 const late=state.orders.filter(o=>o.due&&o.due<today()&&o.stage!=='Entregue').length;
 return `${head('Controle de Produção & Produtos','Acompanhe o fluxo de produção, prazos de entrega e encomendas.',`<div class="inline"><span class="pill">Total: ${state.orders.length}</span><span class="pill overdue">⚠ Atrasados: ${late}</span></div>`)}
 <div class="kanban production-kanban">${stages.map((stage,i)=>`<div class="lane"><div class="lane-head"><span class="stage-icon">${stage.icon}</span><span>${i+1}. ${stage.name}<small>${state.orders.filter(o=>o.stage===stage.name).length} pedido(s)</small></span></div>${state.orders.filter(o=>o.stage===stage.name).map(o=>{const paid=Number(o.paid)||0,total=Number(o.total)||0,fullyPaid=paid>=total,late=o.due&&o.due<today()&&o.stage!=='Entregue',phone=o.clientPhone||state.clients.find(c=>c.id===o.clientId)?.phone||'',address=o.address||state.clients.find(c=>c.id===o.clientId)?.address||'';return `<article class="order-card production-card"><div class="production-card-head"><b>👤 ${esc(o.clientName)}</b><strong>${money(total)}</strong></div>${o.items?.length?`<div class="production-product-list">${o.items.map(it=>`<p>📦 ${esc(it.qty)}× ${esc(it.name)}</p>`).join('')}</div>`:`<p class="production-product">📦 ${esc(o.qty)}× ${esc(o.product)}</p>`}<div class="production-address"><span>📍 ${esc(address||'Endereço não informado')}</span>${address?`<button class="btn small light" data-action="copyAddress" data-id="${o.id}">📋 Copiar</button>`:''}</div><div class="production-delivery"><small>Tipo de entrega:</small><div>${deliveries.map(d=>`<button class="btn small ${o.delivery===d.value?'primary':'light'}" data-action="setDelivery" data-id="${o.id}" data-value="${d.value}">${d.icon} ${d.value}</button>`).join('')}</div></div>${fullyPaid?'<div class="production-paid">☑ Pago por completo</div>':`<div class="production-balance"><div>💰 Entrada paga <b>${money(paid)}</b></div><div>⚠ Falta receber <b>${money(Math.max(0,total-paid))}</b></div><button class="btn small success" data-action="markOrderPaid" data-id="${o.id}">Marcar como quitado</button></div>`}<div class="production-dates"><div><small>📅 Pedido</small><b>${dateBR(o.orderDate||o.date)}</b></div><div><small>Prazo de entrega</small><b>${dateBR(o.due)}</b></div><span class="pill ${late?'overdue':''}">${!o.due?'◷ Sem prazo':late?'⚠ Atrasado':'☑ No prazo'}</span></div><div class="order-actions production-actions"><button class="btn small success" data-action="readyWhatsApp" data-id="${o.id}">📲 Avisar que está pronto</button>${phone?`<button class="btn small success" data-action="orderWhatsApp" data-id="${o.id}">💬 WhatsApp</button>`:''}${i>0?`<button class="btn small light" data-action="prevStage" data-id="${o.id}">◀ Voltar etapa</button>`:''}<button class="btn small light" data-action="editOrder" data-id="${o.id}">✏ Editar pedido</button>${o.stage!=='Entregue'?`<button class="btn small light" data-action="nextStage" data-id="${o.id}">▶ Mover</button>`:''}</div></article>`}).join('')||'<div class="empty">Sem pedidos</div>'}</div>`).join('')}</div>`;
}
function quotesPage(){
 const selectedClientId=quoteClientShortcut;quoteClientShortcut='';const shortcutClient=state.clients.find(c=>c.id===selectedClientId),opts=state.stock.map(s=>`<option value="${s.id}">${esc(s.name)} · ${money(s.unitCost)}/un</option>`).join('');
 return `${head('Calculadora de Precificação & Orçamentos','Monte a composição, confira os custos e prepare seu orçamento.')}
 <form id="quoteForm"><div class="quote-layout">
 <section class="panel quote-composer"><h2>1. Compor produto / cesta / encomenda</h2>
 <div class="field"><label>Modelo salvo</label><div class="quote-model-row"><select id="quoteModelSelect"><option value="">Selecione um modelo</option>${state.models.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button type="button" class="btn light" id="loadQuoteModel">Carregar</button><button type="button" class="btn danger" data-action="deleteQuoteModel" title="Excluir modelo">▣</button></div></div>
 <div class="quote-model-row quote-model-name"><div class="field"><label>Nome da composição</label><input id="compositionName" placeholder="Nome para salvar este modelo"></div><button type="button" class="btn primary" id="saveModel">Salvar modelo</button></div>
 <div class="quote-material-row"><div class="field"><label>Adicionar insumo do estoque</label><select id="materialSelect">${opts||'<option value="">Nenhum insumo cadastrado</option>'}</select></div><div class="field"><label>Qtd.</label><input id="materialQty" type="number" value="1" min="0.01" step="0.01"></div><button type="button" class="btn light" id="addMaterial">+ Insumo</button></div>
 <div class="table-wrap quote-composition-wrap"><table class="quote-composition"><thead><tr><th>Item na encomenda</th><th>Tipo</th><th>Qtd.</th><th>Subtotal custo</th><th>Remover</th></tr></thead><tbody id="compositionRows"></tbody></table><div id="compositionEmpty" class="empty">Adicione insumos para criar uma composição.</div></div>
 </section>
 <section class="panel quote-calculator"><h2>2. Custos, margem real & orçamento</h2>
 <div class="quote-info-grid"><div class="field"><label>👤 Selecione o cliente</label><select id="quoteClient" name="clientId"><option value="">— Cliente avulso —</option>${state.clients.map(c=>`<option value="${c.id}" data-address="${esc(c.address||'')}" data-phone="${esc(c.phone||'')}" ${c.id===selectedClientId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>🧾 Nome da encomenda no orçamento</label><input name="product" placeholder="Ex.: Kit Dia dos Namorados" required></div><div class="field"><label>📅 Data do pedido</label><input name="orderDate" type="date" value="${today()}" required></div><div class="field"><label>🚚 Previsão de entrega</label><input name="due" type="date" required></div><div class="field quote-full"><label>📍 Endereço de entrega</label><input id="quoteAddress" name="address" placeholder="Endereço do cliente ou local de retirada" value="${esc(shortcutClient?.address||'')}"></div><div class="field quote-full"><label>📦 Quantidade de encomendas solicitadas</label><input name="qty" type="number" value="1" min="1" step="1"></div></div>
 <div class="quote-delivery-field"><label>🚚 Tipo de entrega</label><div class="quote-delivery-options"><label><input type="radio" name="delivery" value="Loja" checked><span>🏬 Loja</span></label><label><input type="radio" name="delivery" value="MotoUber"><span>🛵 MotoUber</span></label><label><input type="radio" name="delivery" value="Correios"><span>🚚 Correios</span></label></div></div>
 <div class="quote-pricing"><div class="quote-pricing-head"><label for="quoteMargin">Margem de lucro real desejada (%)</label><div class="quote-margin-controls"><select name="marginMode" aria-label="Tipo de cálculo"><option value="margin">Margem</option><option value="markup">Acréscimo</option></select><output id="marginOutput">50%</output></div></div><input id="quoteMargin" name="margin" type="range" min="0" max="90" value="50"><small id="marginHint">Margem real: percentual do lucro sobre o preço final cobrado.</small><div class="field quote-price-field"><label for="quotePrice">Ou digite quanto vai vender no total (R$):</label><input id="quotePrice" name="price" type="number" placeholder="Ex.: 70,00" min="0" step="0.01"></div></div>
 <div class="field quote-payment-field"><label>Forma de pagamento do cliente</label><div class="quote-payment-options"><label class="quote-choice"><input type="radio" name="payment" value="Pix" checked><span>💠 <b>Pix</b><small>À vista</small></span></label><label class="quote-choice"><input type="radio" name="payment" value="Cartão"><span>▣ <b>Cartão</b><small>Crédito / Débito</small></span></label><label class="quote-choice"><input type="radio" name="payment" value="Dinheiro"><span>💵 <b>Dinheiro</b><small>Espécie</small></span></label></div></div>
 <div class="quote-deposit"><div class="quote-deposit-head"><b>🔒 Sinal de entrada / início da produção</b><span id="depositBadge">50% entrada</span></div><div class="quote-deposit-options"><label><input type="radio" name="deposit" value="0"><span>Sem entrada</span></label><label><input type="radio" name="deposit" value="50" checked><span>50% (Padrão)</span></label><label><input type="radio" name="deposit" value="30"><span>30%</span></label><label><input type="radio" name="deposit" value="100"><span>À vista (100%)</span></label><label class="deposit-custom"><input type="radio" name="deposit" value="manual"><span>R$</span><input type="number" id="customDeposit" min="0" step="0.01" placeholder="Valor de entrada" aria-label="Valor de entrada em reais"></label></div></div>
 <div class="quote-pay-summary"><div><small>💰 Entrada paga pelo cliente</small><b id="depositAmount">R$ 0,00</b></div><div><small>📦 Saldo restante</small><b id="remainingAmount">R$ 0,00</b></div></div>
 <div class="quote-total-cards"><div><small>Custo total</small><b id="quoteCost">R$ 0,00</b></div><div><small>Preço sugerido</small><b id="quoteSuggested">R$ 0,00</b></div><div><small>Margem de lucro</small><b id="quoteProfit">R$ 0,00</b><small id="quoteRealMargin">0% de margem real</small></div></div>
 <div class="quote-actions"><button class="btn primary" type="submit">▤ Gerar orçamento</button><button class="btn success" type="button" id="launchSale">✓ Lançar venda</button><button class="btn light quote-copy-btn" type="button" id="generateQuoteCopy">▧ Gerar cópia do pedido para WhatsApp</button></div>
 </section></div></form>
 <section class="panel quote-generated"><h2>Orçamentos gerados (aguardando aprovação do cliente)</h2>${state.quotes.length?`<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Previsão</th><th>Produto</th><th>Cliente</th><th>Total</th><th>Status</th><th>Ação</th></tr></thead><tbody>${state.quotes.slice().reverse().map(q=>`<tr><td>${dateBR(q.orderDate||q.date)}</td><td>${dateBR(q.due)}</td><td>${esc(q.product)}</td><td>${esc(q.clientName||'Cliente avulso')}</td><td>${money(q.price)}</td><td><span class="pill pending">${esc(q.status)}</span></td><td>${q.status==='Aprovado'?(q.orderId?'<span class="pill">Enviado à produção</span>':'<span class="pill">Aprovado</span>'):`<button class="btn small success" data-action="approveQuote" data-id="${q.id}">Aprovar venda</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Os orçamentos criados aparecerão aqui.</div>'}<div class="notice">A aprovação deve ser feita após a confirmação do cliente. A venda aprovada passa a compor o dashboard e a produção.</div></section>`;
}
function clientsPage(){
 const birthdays=state.clients.filter(c=>c.birth&&c.birth.slice(5,7)===String(new Date().getMonth()+1).padStart(2,'0'));
 return `${head('Clientes & Aniversários','Cadastre seus clientes e mantenha os dados de contato organizados.')}
 <section class="birthday"><h2>🎂 Aniversariantes do mês</h2><p>Envie uma mensagem de carinho pelo WhatsApp.</p><div class="birthday-row">${birthdays.map(c=>`<div class="birthday-card"><b>${esc(c.name)}</b><small>${dateBR(c.birth)}</small><div><button class="btn small success" data-action="birthday" data-id="${c.id}">Enviar parabéns</button></div></div>`).join('')||'<span class="muted">Nenhum aniversário neste mês.</span>'}</div></section>
 ${panel('Importar clientes em lote',`<p class="muted">Cole um cliente por linha, com os campos separados por ponto e vírgula: <b>nome; telefone; nascimento; endereço</b>. Exemplo: Maria Silva; (11) 99999-9999; 25/03/1990; Rua das Flores, 10.</p><form id="bulkClientForm"><div class="field"><label>Dados dos clientes</label><textarea name="rows" rows="5" placeholder="Maria Silva; (11) 99999-9999; 25/03/1990; Rua das Flores, 10&#10;João Souza; (11) 98888-7777; 1985-08-12; Av. Central, 20" required></textarea></div><div class="form-actions"><button class="btn primary">Importar clientes</button></div></form>`)}
 <div class="grid two-col">${panel('Cadastrar novo cliente',`<form id="clientForm" class="form-grid">${field('Nome completo','name','text','Ex.: Maria Silva','','required')}${field('WhatsApp / telefone','phone','tel','(00) 99999-9999')}${field('Data de nascimento','birth','date')}${field('Endereço completo','address','text','Rua, número, bairro, cidade - UF','') }<div class="form-actions span-2"><button class="btn primary">Cadastrar cliente</button></div></form>`)}
 ${panel('Lista de clientes cadastrados',`<input id="clientSearch" placeholder="Buscar cliente por nome ou WhatsApp"><div style="height:12px"></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>Nascimento</th><th>Ações</th></tr></thead><tbody id="clientRows">${clientRows()}</tbody></table></div>`)}</div>`;
}
function clientRows(){return state.clients.map(c=>`<tr data-search="${esc((c.name+' '+c.phone).toLowerCase())}"><td><b>${esc(c.name)}</b><br><small>${esc(c.address)}</small></td><td>${esc(c.phone||'—')}</td><td>${dateBR(c.birth)}</td><td><button class="btn small primary" data-action="quoteForClient" data-id="${c.id}" title="Abrir a calculadora para este cliente">Novo orçamento</button> <button class="btn small light" data-action="editClient" data-id="${c.id}">Editar cadastro</button> <button class="btn small danger" data-action="deleteClient" data-id="${c.id}">Excluir</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum cliente cadastrado.</td></tr>'}
function normalizedPhone(phone){return String(phone||'').replace(/\D/g,'')}
function whatsappPhone(phone){let digits=normalizedPhone(phone);return digits.length===10||digits.length===11?`55${digits}`:digits}
function normalizedBirth(value){let v=value instanceof Date?value.toISOString().slice(0,10):String(value||'').trim();if(!v)return '';let m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;m=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:$|\s)/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;m=v.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?/);if(m){const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'},mo=months[m[1].toLowerCase()];if(mo)return `${m[3]||new Date().getFullYear()}-${mo}-${m[2].padStart(2,'0')}`}const parsed=new Date(v);if(!Number.isNaN(parsed.getTime()))return parsed.toISOString().slice(0,10);return null}
function stockPage(){
 const purchases=(state.purchases||[]).slice().reverse().slice(0,10);
 return `${head('Estoque de Insumos','Cadastre materiais, acompanhe custos unitários e controle compras e saídas.')}
 <div class="grid two-col">${panel('Cadastrar insumo',`<form id="stockForm" class="form-grid">${field('Nome do insumo','name','text','Ex.: Tinta sublimática','','required')}${field('Qtd. na embalagem','packQty','number','1','1','min="0.01" step="0.01"')}${field('Preço pago (R$)','packPrice','number','35.00','','min="0" step="0.01"')}${field('Estoque atual (unidades)','qty','number','Ex.: 10','0','min="0" step="0.01"') }<div class="form-actions span-2"><button class="btn primary">Salvar insumo</button></div></form>`)}
 ${panel('Insumos cadastrados',`<input id="stockSearch" placeholder="Buscar insumo cadastrado..."><div style="height:12px"></div><div class="table-wrap"><table><thead><tr><th>Insumo</th><th>Qtd. atual</th><th>Custo/un.</th><th>Valor estoque</th><th>Ações</th></tr></thead><tbody id="stockRows">${stockRows()}</tbody></table></div>`)}</div>
 <section class="panel purchase-cta"><div><h2>Compras de insumos</h2><p class="muted">Registre uma compra, vincule os itens ao estoque e atualize as quantidades automaticamente.</p></div><button class="btn primary" data-action="openPurchase">＋ Registrar compra de insumos</button></section>
 ${panel('Compras recentes',purchases.length?`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Total</th></tr></thead><tbody>${purchases.map(p=>`<tr><td>${dateBR(p.date)}</td><td>${esc(p.supplier||'—')}</td><td>${p.items.map(i=>`${esc(i.name)} × ${i.qty}`).join('<br>')}</td><td>${money(p.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhuma compra registrada.</div>')}`;
}
function purchaseOptions(selected=''){return `<option value="">Selecione um insumo</option>${state.stock.map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${esc(s.name)} (atual: ${s.qty})</option>`).join('')}`}
function addPurchaseLine(selected='',qty='1',unitCost=''){
 const id=uid(),body=document.querySelector('#purchaseLines');if(!body)return;
 const stock=state.stock.find(s=>s.id===selected),cost=unitCost!==''?unitCost:(stock?.unitCost??'');
 body.insertAdjacentHTML('beforeend',`<div class="purchase-line" data-line="${id}"><div class="field"><label>Insumo</label><select class="purchase-stock" required>${purchaseOptions(selected)}</select></div><div class="field"><label>Quantidade</label><input class="purchase-qty" type="number" min="0.01" step="0.01" value="${qty}" required></div><div class="field"><label>Custo unitário (R$)</label><input class="purchase-cost" type="number" min="0" step="0.01" value="${cost}" required></div><button type="button" class="btn light purchase-new" data-purchase-new="${id}">＋ Criar insumo</button><button type="button" class="btn danger" data-purchase-remove="${id}" aria-label="Remover item">×</button></div>`);
 updatePurchaseTotal();
}
function openPurchaseDialog(){
 document.querySelector('#purchaseDialogBody').innerHTML=`<form id="purchaseForm"><div class="purchase-head-fields">${field('Data da compra','date','date','',today(),'required')}${field('Fornecedor (opcional)','supplier','text','Nome do fornecedor')}</div><div class="purchase-lines-head"><b>Itens comprados</b><button type="button" class="btn light" data-purchase-add>＋ Adicionar item</button></div><div id="purchaseLines"></div><div class="purchase-total"><span>Total da compra</span><b id="purchaseTotal">R$ 0,00</b></div><div class="form-actions"><button type="button" class="btn light" onclick="cancelPurchaseDialog()">Cancelar</button><button class="btn primary">Salvar compra e atualizar estoque</button></div></form>`;
 addPurchaseLine();document.querySelector('#purchaseDialog').showModal();
}
function cancelPurchaseDialog(){document.querySelector('#purchaseDialog').close();render()}
function updatePurchaseTotal(){let total=0;document.querySelectorAll('.purchase-line').forEach(row=>{total+=(Number(row.querySelector('.purchase-qty').value)||0)*(Number(row.querySelector('.purchase-cost').value)||0)});let target=document.querySelector('#purchaseTotal');if(target)target.textContent=money(total)}
function stockRows(){return state.stock.map(s=>`<tr data-search="${esc(s.name.toLowerCase())}"><td><b>${esc(s.name)}</b></td><td>${s.qty} ${esc(s.unit||'un')} ${Number(s.qty)<=Number(s.minimum??state.settings.lowStock)?'<span class="pill overdue">Baixo</span>':''}</td><td>${money(s.unitCost)}</td><td>${money(s.qty*s.unitCost)}</td><td><button class="btn small light" data-action="editStockQty" data-id="${s.id}">Editar quantidade</button> <button class="btn small light" data-action="stockMove" data-id="${s.id}">Entrada / saída</button> <button class="btn small danger" data-action="deleteStock" data-id="${s.id}">Excluir</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum insumo cadastrado.</td></tr>'}
function expensesPage(){
 const total=state.expenses.reduce((a,e)=>a+Number(e.amount),0),profit=state.sales.reduce((a,s)=>a+Number(s.total)-Number(s.cost||0),0)-total;
 return `${head('Despesas Fixas & Variáveis do Ateliê','Registre despesas do negócio e acompanhe o resultado após os lançamentos.')}
 <div class="grid stats">${stat('Total de despesas',money(total),'Soma de tudo que foi lançado')}${stat('Lucro após despesas',money(profit),'Lucro estimado das vendas menos despesas','green')}</div>
 <div class="grid two-col">${panel('Lançar despesa',`<form id="expenseForm" class="form-grid">${field('O que foi','description','text','Ex.: Energia elétrica, embalagem...','','required')}${field('Valor (R$)','amount','number','30.00','','min="0.01" step="0.01" required')}${field('Data','date','date','',today(),'required')}<div class="form-actions span-2"><button class="btn primary">Cadastrar despesa</button></div></form>`)}
 ${panel('Despesas lançadas',`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${state.expenses.slice().reverse().map(e=>`<tr><td>${dateBR(e.date)}</td><td>${esc(e.description)}</td><td>${money(e.amount)}</td><td><button class="btn small danger" data-action="deleteExpense" data-id="${e.id}">Excluir</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhuma despesa lançada.</td></tr>'}</tbody></table></div>`)}</div>`;
}
function settingsPage(){
 const entityOptions=[
  ['clientes','Clientes (clientes)'],
  ['estoque','Estoque de Insumos (estoque)'],
  ['produtos','Catálogo de Produtos (produtos)'],
  ['controles_da_producao','Pedidos / Produção (controles_da_producao)'],
  ['controle_producao_itens','Itens da Produção (controle_producao_itens)'],
  ['controle_item_insumos','Insumos dos Itens da Produção (controle_item_insumos)'],
  ['vendas','Vendas Confirmadas (vendas)'],
  ['venda_itens','Itens das Vendas (venda_itens)'],
  ['venda_item_insumos','Insumos dos Itens das Vendas (venda_item_insumos)'],
  ['orcamentos','Orçamentos (orcamentos)'],
  ['orcamento_insumos','Insumos dos Orçamentos (orcamento_insumos)'],
  ['compras','Compras de Insumos (compras)'],
  ['compra_itens','Itens das Compras (compra_itens)'],
  ['despesas','Despesas do Ateliê (despesas)'],
  ['modelos','Modelos de Composição (modelos)'],
  ['modelo_insumos','Insumos dos Modelos (modelo_insumos)'],
  ['configuracoes','Configurações do Negócio (configuracoes)']
 ];
 return `${head('Minha Conta & Configurações','Personalize os dados do negócio e mantenha uma cópia dos seus registros.')}
 <div class="grid two-col">${panel('Dados do negócio',`<form id="settingsForm" class="form-grid">${field('Nome do negócio','business','text','',state.settings.business)}${field('WhatsApp','phone','tel','',state.settings.phone)}<div class="field span-2"><label>Endereço</label><input name="address" value="${esc(state.settings.address)}"></div>${field('Alerta de estoque baixo (unidades)','lowStock','number','5',state.settings.lowStock)}<div class="form-actions span-2"><button class="btn primary">Salvar configurações</button></div></form>`)}
 ${panel('Backup e restauração por entidades',`<p class="muted">Exporte seus dados estruturados e separados por entidade (clientes, estoque, produtos, compras, vendas, pedidos de produção, orçamentos, despesas, modelos e configurações).</p>
 <div class="inline" style="margin:10px 0 14px;gap:6px">
  <span class="pill">Clientes: ${state.clients.length}</span>
  <span class="pill">Estoque: ${state.stock.length}</span>
  <span class="pill">Pedidos: ${state.orders.length}</span>
  <span class="pill">Vendas: ${state.sales.length}</span>
  <span class="pill">Orçamentos: ${state.quotes.length}</span>
  <span class="pill">Compras: ${(state.purchases||[]).length}</span>
  <span class="pill">Despesas: ${state.expenses.length}</span>
  <span class="pill">Modelos: ${state.models.length}</span>
 </div>
 <div class="form-actions">
  <button class="btn primary" type="button" data-action="export">⇩ Exportar Backup JSON (Entidades Separadas)</button>
  <button class="btn light" type="button" data-action="exportZip">⇩ Exportar Pacote ZIP (1 arquivo por entidade JSON + CSV)</button>
  <label class="btn light" for="importFile">⇧ Importar Backup JSON</label>
  <input id="importFile" type="file" accept="application/json,.json" hidden>
 </div>
 <label class="inline muted" style="margin-top:10px;font-size:12px;cursor:pointer">
  <input type="checkbox" id="replaceOnRestore" style="width:auto;margin:0">
  <span>Substituir toda a base atual ao importar um backup completo (desmarcado = mesclar/atualizar registros)</span>
 </label>
 <div class="form-grid" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
  <div class="field"><label>Exportar entidade individual</label><select id="exportEntitySelect">${entityOptions.map(([val,label])=>`<option value="${val}">${esc(label)}</option>`).join('')}</select></div>
  <div class="field"><label>Formato da entidade</label><select id="exportFormatSelect"><option value="json">JSON (estruturado)</option><option value="csv">CSV (planilha Excel)</option></select></div>
  <div class="form-actions span-2" style="margin-top:4px"><button class="btn light" type="button" data-action="exportEntity">⇩ Baixar entidade selecionada</button></div>
 </div>
 <div class="notice">Os dados são sincronizados diretamente com o banco PostgreSQL. Antes de qualquer restauração, o servidor grava automaticamente uma cópia de segurança em <code>backups/pre-restore-*.json</code>.</div>
 <div class="form-actions"><button class="btn light" type="button" onclick="signOut()">Sair da conta</button><button class="btn danger" type="button" data-action="reset">Apagar todos os dados</button></div>`)}</div>`;
}
let composition=[];
function quoteNumbers(){let f=document.querySelector('#quoteForm');if(!f)return null;let qty=Math.max(1,Number(f.elements.qty.value)||1),cost=composition.reduce((a,x)=>a+x.qty*x.unitCost,0)*qty,rate=Number(f.elements.margin.value)||0,mode=f.elements.marginMode.value,suggested=mode==='markup'?cost*(1+rate/100):(rate>=100?0:cost/(1-rate/100)),price=Number(f.elements.price.value)||suggested,selected=f.querySelector('input[name="deposit"]:checked'),depositMode=selected?.value||'50',manualAmount=Number(document.querySelector('#customDeposit')?.value)||0,depositRate=depositMode==='manual'?(price?Math.min(100,Math.max(0,manualAmount/price*100)):0):Math.min(100,Math.max(0,Number(depositMode)||0)),depositAmount=depositMode==='manual'?Math.min(price,Math.max(0,manualAmount)):price*depositRate/100;return {f,qty,cost,rate,mode,suggested,price,profit:price-cost,realMargin:price?((price-cost)/price)*100:0,depositMode,depositRate,depositAmount:Math.round(depositAmount*100)/100,remainingAmount:Math.max(0,Math.round((price-depositAmount)*100)/100)}}
function recalcQuote(){let data=quoteNumbers();if(!data)return;let {f,cost,rate,mode,suggested,price,profit,realMargin,depositMode,depositRate,depositAmount,remainingAmount}=data,rows=document.querySelector('#compositionRows');rows.innerHTML=composition.map(x=>`<tr><td>${esc(x.name)}</td><td>Insumo</td><td>${x.qty}</td><td>${money(x.qty*x.unitCost*data.qty)}</td><td><button type="button" class="btn small danger" data-remove="${x.id}">Remover</button></td></tr>`).join('');document.querySelector('#compositionEmpty').hidden=composition.length>0;document.querySelector('#marginOutput').textContent=`${rate}%`;document.querySelector('#marginHint').textContent=mode==='margin'?'Margem real: percentual do lucro sobre o preço final cobrado.':'Acréscimo: percentual aplicado sobre o custo total.';document.querySelector('#quoteCost').textContent=money(cost);document.querySelector('#quoteSuggested').textContent=money(suggested);document.querySelector('#quoteProfit').textContent=money(profit);document.querySelector('#quoteRealMargin').textContent=`${realMargin.toFixed(1)}% de margem real`;document.querySelector('#depositBadge').textContent=depositMode==='manual'?`${money(depositAmount)} de entrada`:`${depositRate}% entrada`;document.querySelector('#depositAmount').textContent=money(depositAmount);document.querySelector('#remainingAmount').textContent=money(remainingAmount);if(!f.elements.price.value&&suggested)f.elements.price.placeholder=`Sugestão: ${suggested.toFixed(2)}`;document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{composition=composition.filter(x=>x.id!==b.dataset.remove);recalcQuote()})}
function copyText(ctx,text,x,y,maxWidth,font,color,maxLines=2){ctx.font=font;ctx.fillStyle=color;const words=String(text||'').split(/\s+/),lines=[];let line='';for(const word of words){const next=line?`${line} ${word}`:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);const visible=lines.slice(0,maxLines);if(lines.length>maxLines){let last=visible[maxLines-1]||'';while(last&&ctx.measureText(`${last}…`).width>maxWidth)last=last.slice(0,-1);visible[maxLines-1]=`${last}…`}visible.forEach((row,i)=>ctx.fillText(row,x,y+i*34));return visible.length*34}
function roundedCard(ctx,x,y,w,h,fill,stroke='#ead9e8'){ctx.beginPath();ctx.roundRect(x,y,w,h,22);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}}
async function generateQuoteCopy(){const form=document.querySelector('#quoteForm');if(!form||!form.reportValidity())return;const data=quoteNumbers(),product=form.elements.product.value.trim(),orderDate=form.elements.orderDate.value,due=form.elements.due.value;if(!product||!data?.price||data.price<=0){toast('Informe o nome da encomenda e um preço maior que zero.');return}const selected=form.querySelector('#quoteClient'),client=state.clients.find(c=>c.id===selected.value),clientName=client?.name||'Cliente avulso',address=form.elements.address.value.trim(),payment=form.querySelector('input[name="payment"]:checked')?.value||'Não informado',delivery=form.querySelector('input[name="delivery"]:checked')?.value||'Loja',canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx){toast('Não foi possível gerar a imagem neste navegador.');return}canvas.width=1080;canvas.height=address?1290:1160;ctx.fillStyle='#f8f3f8';ctx.fillRect(0,0,canvas.width,canvas.height);roundedCard(ctx,34,34,1012,canvas.height-68,'#ffffff');roundedCard(ctx,54,54,972,190,'#85477f',null);ctx.fillStyle='#fff';ctx.font='700 46px Arial';ctx.fillText(state.settings.business||'Allegra gráfica & personalizados',86,122,870);ctx.font='600 23px Arial';ctx.fillStyle='#f9eafa';ctx.fillText('CÓPIA DO PEDIDO',86,177);ctx.textAlign='right';ctx.font='500 21px Arial';ctx.fillText(`Gerado em ${dateBR(today())}`,994,177);ctx.textAlign='left';
 let y=294;ctx.fillStyle='#91748f';ctx.font='700 18px Arial';ctx.fillText('CLIENTE',82,y);copyText(ctx,clientName,82,y+43,900,'700 30px Arial','#302235',1);y+=108;
 ctx.fillStyle='#91748f';ctx.font='700 18px Arial';ctx.fillText('ENCOMENDA',82,y);copyText(ctx,product,82,y+43,900,'700 31px Arial','#302235',2);y+=108;
 roundedCard(ctx,76,y,450,112,'#fdf7fc');roundedCard(ctx,546,y,458,112,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('DATA DO PEDIDO',100,y+34);ctx.fillText('PREVISÃO DE ENTREGA',570,y+34);ctx.fillStyle='#302235';ctx.font='700 25px Arial';ctx.fillText(dateBR(orderDate),100,y+78);ctx.fillText(dateBR(due),570,y+78);y+=144;
 roundedCard(ctx,76,y,450,112,'#fdf7fc');roundedCard(ctx,546,y,458,112,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('QUANTIDADE',100,y+34);ctx.fillText('ENTREGA / PAGAMENTO',570,y+34);ctx.fillStyle='#302235';ctx.font='700 25px Arial';ctx.fillText(`${data.qty} ${data.qty===1?'encomenda':'encomendas'}`,100,y+78);copyText(ctx,`${delivery} · ${payment}`,570,y+73,410,'700 22px Arial','#302235',1);y+=144;
 if(address){roundedCard(ctx,76,y,928,102,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('ENDEREÇO / LOCAL DE ENTREGA',100,y+32);copyText(ctx,address,100,y+69,875,'500 21px Arial','#302235',1);y+=126}
 roundedCard(ctx,76,y,928,205,'#faedf7');ctx.fillStyle='#7b3e74';ctx.font='700 18px Arial';ctx.fillText('VALORES DO PEDIDO',104,y+42);ctx.fillStyle='#302235';ctx.font='700 17px Arial';ctx.fillText('TOTAL',104,y+87);ctx.fillText('ENTRADA INICIAL',420,y+87);ctx.fillText('SALDO RESTANTE',716,y+87);ctx.fillStyle='#7b3e74';ctx.font='700 31px Arial';ctx.fillText(money(data.price),104,y+139);ctx.fillStyle='#07845f';ctx.fillText(money(data.depositAmount),420,y+139);ctx.fillStyle='#b85b08';ctx.fillText(money(data.remainingAmount),716,y+139);ctx.strokeStyle='#e5cfe2';ctx.beginPath();ctx.moveTo(104,y+158);ctx.lineTo(976,y+158);ctx.stroke();ctx.fillStyle='#705c70';ctx.font='500 17px Arial';ctx.fillText(`${data.depositRate}% de entrada · ${money(data.remainingAmount)} previstos para a entrega`,104,y+187);
 ctx.fillStyle='#91748f';ctx.font='500 17px Arial';ctx.textAlign='center';ctx.fillText(state.settings.phone?`Allegra gráfica & personalizados · ${state.settings.phone}`:'Obrigada pela preferência!',540,y+252);ctx.textAlign='left';const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob){toast('Não foi possível criar o arquivo PNG.');return}const fileName=`pedido-allegra-${today()}.png`;try{if(typeof File!=='undefined'&&navigator.share){const file=new File([blob],fileName,{type:'image/png'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:`Pedido: ${product}`,text:`Segue a cópia do pedido de ${clientName}.`});toast('Imagem pronta para compartilhar. Escolha o WhatsApp na tela de compartilhamento.');return}}}catch(error){if(error.name==='AbortError'){downloadQuoteCopy(blob,fileName);toast('Compartilhamento cancelado. A imagem foi baixada para você enviar depois.');return}}downloadQuoteCopy(blob,fileName);toast('Cópia do pedido baixada em PNG. Anexe a imagem na conversa do WhatsApp.')}
function downloadQuoteCopy(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
async function generateOrderEditCopy(){const form=document.querySelector('#editOrderForm');if(!form||!form.reportValidity())return;const order=state.orders.find(o=>o.id===form.dataset.id);if(!order)return;const items=[...form.querySelectorAll('.order-edit-item')].map(row=>({name:row.querySelector('.order-item-name').value.trim(),qty:Number(row.querySelector('.order-item-qty').value)||0,unitPrice:Number(row.querySelector('.order-item-price').value)||0,paid:Number(row.querySelector('.order-item-paid').value)||0}));if(!items.length){toast('Adicione ao menos um item para gerar a cópia.');return}const total=items.reduce((sum,item)=>sum+item.qty*item.unitPrice,0),received=items.reduce((sum,item)=>sum+item.paid,0),balance=Math.max(0,total-received),address=form.elements.address.value.trim(),orderDate=form.elements.orderDate.value,due=form.elements.due.value,delivery=form.elements.delivery.value,payment=form.elements.payment.value,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx){toast('Não foi possível gerar a imagem neste navegador.');return}canvas.width=1080;canvas.height=(address?1010:900)+items.length*100;ctx.fillStyle='#f8f3f8';ctx.fillRect(0,0,canvas.width,canvas.height);roundedCard(ctx,34,34,1012,canvas.height-68,'#ffffff');roundedCard(ctx,54,54,972,180,'#85477f',null);ctx.fillStyle='#fff';ctx.font='700 46px Arial';ctx.fillText(state.settings.business||'Allegra gráfica & personalizados',86,120,870);ctx.font='600 23px Arial';ctx.fillStyle='#f9eafa';ctx.fillText('CÓPIA DO PEDIDO',86,174);ctx.textAlign='right';ctx.font='500 21px Arial';ctx.fillText(`Gerado em ${dateBR(today())}`,994,174);ctx.textAlign='left';let y=278;ctx.fillStyle='#91748f';ctx.font='700 18px Arial';ctx.fillText('CLIENTE',82,y);copyText(ctx,order.clientName||'Cliente avulso',82,y+42,900,'700 30px Arial','#302235',1);y+=98;roundedCard(ctx,76,y,450,104,'#fdf7fc');roundedCard(ctx,546,y,458,104,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('DATA DO PEDIDO',100,y+34);ctx.fillText('PREVISÃO DE ENTREGA',570,y+34);ctx.fillStyle='#302235';ctx.font='700 25px Arial';ctx.fillText(dateBR(orderDate),100,y+77);ctx.fillText(dateBR(due),570,y+77);y+=126;roundedCard(ctx,76,y,450,104,'#fdf7fc');roundedCard(ctx,546,y,458,104,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('TIPO DE ENTREGA',100,y+34);ctx.fillText('FORMA DE PAGAMENTO',570,y+34);ctx.fillStyle='#302235';ctx.font='700 25px Arial';ctx.fillText(delivery,100,y+77);ctx.fillText(payment,570,y+77);y+=126;if(address){roundedCard(ctx,76,y,928,100,'#fdf7fc');ctx.fillStyle='#91748f';ctx.font='700 17px Arial';ctx.fillText('ENDEREÇO / LOCAL DE ENTREGA',100,y+32);copyText(ctx,address,100,y+68,875,'500 21px Arial','#302235',1);y+=120}ctx.fillStyle='#7b3e74';ctx.font='700 21px Arial';ctx.fillText('ITENS DO PEDIDO',82,y+8);y+=30;items.forEach((item,index)=>{roundedCard(ctx,76,y,928,88,index%2?'#ffffff':'#fdf7fc');copyText(ctx,item.name,98,y+39,455,'700 22px Arial','#302235',1);ctx.fillStyle='#705c70';ctx.font='500 18px Arial';ctx.fillText(`${item.qty} × ${money(item.unitPrice)}`,590,y+52);ctx.textAlign='right';ctx.fillStyle='#302235';ctx.font='700 22px Arial';ctx.fillText(money(item.qty*item.unitPrice),980,y+52);ctx.textAlign='left';y+=96});y+=8;roundedCard(ctx,76,y,928,174,'#faedf7');ctx.fillStyle='#7b3e74';ctx.font='700 18px Arial';ctx.fillText('RESUMO DO PEDIDO',104,y+38);ctx.fillStyle='#705c70';ctx.font='700 17px Arial';ctx.fillText('TOTAL',104,y+78);ctx.fillText('VALOR RECEBIDO',420,y+78);ctx.fillText('SALDO A RECEBER',716,y+78);ctx.fillStyle='#7b3e74';ctx.font='700 30px Arial';ctx.fillText(money(total),104,y+125);ctx.fillStyle='#07845f';ctx.fillText(money(received),420,y+125);ctx.fillStyle='#b85b08';ctx.fillText(money(balance),716,y+125);ctx.fillStyle='#91748f';ctx.font='500 17px Arial';ctx.textAlign='center';ctx.fillText(state.settings.phone?`Allegra gráfica & personalizados · ${state.settings.phone}`:'Obrigada pela preferência!',540,y+218);ctx.textAlign='left';const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob){toast('Não foi possível criar o arquivo PNG.');return}const name=`pedido-allegra-${today()}.png`;try{if(typeof File!=='undefined'&&navigator.share){const file=new File([blob],name,{type:'image/png'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:`Pedido: ${order.clientName||'Cliente'}`,text:'Segue a cópia atualizada do seu pedido.'});toast('Imagem pronta para compartilhar. Escolha o WhatsApp na tela de compartilhamento.');return}}}catch(error){if(error.name==='AbortError'){downloadQuoteCopy(blob,name);toast('Compartilhamento cancelado. A imagem foi baixada para você enviar depois.');return}}downloadQuoteCopy(blob,name);toast('Cópia do pedido baixada em PNG. Anexe a imagem na conversa do WhatsApp.')}
function recordConfirmedSale({clientId,clientName,clientPhone,address,product,qty,total,payment,deposit=50,depositAmount=null,orderDate,due,delivery,composition=[]}){
 const quantity=Math.max(1,Number(qty)||1),requirements=new Map(),items=[];
 for(const line of composition||[]){const stock=state.stock.find(s=>s.id===line.stockId);if(!stock){toast(`O insumo "${line.name}" não está mais cadastrado.`);return false}const used=roundQty((Number(line.qty)||0)*quantity);requirements.set(stock.id,roundQty((requirements.get(stock.id)||0)+used));items.push({line,stock,used})}
 for(const [stockId,used] of requirements){const stock=state.stock.find(s=>s.id===stockId);if(Number(stock.qty)<used){toast(`Estoque insuficiente de ${stock.name}: disponível ${stock.qty}, necessário ${used}.`);return false}}
 const cost=Math.round(items.reduce((sum,x)=>sum+x.used*Number(x.stock.unitCost??x.line.unitCost??0),0)*100)/100;
 requirements.forEach((used,stockId)=>{const stock=state.stock.find(s=>s.id===stockId);stock.qty=roundQty(Number(stock.qty)-used)});
 const totalAmount=Math.max(0,Number(total)||0),requestedPaid=depositAmount==null?totalAmount*Math.min(100,Math.max(0,Number(deposit)||0))/100:Number(depositAmount)||0,paid=Math.round(Math.min(totalAmount,Math.max(0,requestedPaid))*100)/100;
 const saleItem={id:uid(),name:product,qty:quantity,unitPrice:totalAmount/quantity,paidAmount:paid,composition:composition.map(x=>({...x}))};
 const orderItem={id:uid(),name:product,qty:quantity,unitPrice:totalAmount/quantity,paidAmount:paid,composition:composition.map(x=>({...x}))};
 const normalizedOrderDate=normalizedBirth(orderDate)||today(),normalizedDue=normalizedBirth(due)||'';
 const sale={id:uid(),date:today(),orderDate:normalizedOrderDate,clientId:clientId||'',clientName:clientName||'Cliente avulso',clientPhone:clientPhone||'',address:address||'',product,qty:quantity,total:Number(total)||0,paid,cost,payment,delivery:delivery||'Loja',due:normalizedDue,composition:composition.map(x=>({...x})),items:[saleItem]};
 const order={id:uid(),saleId:sale.id,date:normalizedOrderDate,orderDate:normalizedOrderDate,clientId:clientId||'',clientName:sale.clientName,clientPhone:sale.clientPhone,address:sale.address,product,qty:quantity,total:sale.total,paid,cost,due:normalizedDue,delivery:delivery||'Loja',payment,stage:'Criação de Arte',composition:composition.map(x=>({...x})),items:[orderItem]};
 sale.orderId=order.id;state.sales.push(sale);state.orders.push(order);return true;
}
function orderMaterialRow(material={}){return `<div class="order-material-row"><select class="order-material-stock" required>${purchaseOptions(material.stockId||'')}</select><input class="order-material-qty" type="number" min="0.01" step="0.01" value="${Number(material.qty)||''}" placeholder="Qtd. por item" required><button type="button" class="btn danger" data-order-remove-material aria-label="Remover insumo">×</button></div>`}
function orderItemEditor(item,isNew=false){
 const id=item.id||uid(),qty=Number(item.qty)||1,unitPrice=Number(item.unitPrice)||0,total=qty*unitPrice,paid=Number(item.paidAmount)||0,status=isNew?'':paid>=total&&total>0?'received':paid>0?'partial':'due';
 const composition=item.composition||[];
 return `<article class="order-edit-item" data-item-id="${id}" data-new="${isNew?'true':'false'}"><div class="order-edit-item-fields"><div class="field"><label>Produto / item</label><input class="order-item-name" value="${esc(item.name||'')}" required></div><div class="field"><label>Quantidade</label><input class="order-item-qty" type="number" min="1" step="1" value="${qty}" required></div><div class="field"><label>Valor unitário (R$)</label><input class="order-item-price" type="number" min="0" step="0.01" value="${unitPrice.toFixed(2)}" required></div><div class="field"><label>Pagamento deste item</label><select class="order-item-status" required><option value="">Confirme: recebido ou a receber</option><option value="received" ${status==='received'?'selected':''}>Recebido</option><option value="due" ${status==='due'?'selected':''}>A receber</option><option value="partial" ${status==='partial'?'selected':''}>Parcialmente recebido</option></select></div><div class="field"><label>Valor recebido (R$)</label><input class="order-item-paid" type="number" min="0" step="0.01" value="${paid.toFixed(2)}" required></div><button type="button" class="btn danger order-remove-item" data-order-remove-item>Remover item</button></div><details class="order-item-materials"><summary>Insumos usados (baixa no estoque)</summary><div class="order-material-list">${composition.map(orderMaterialRow).join('')}</div><button type="button" class="btn small light" data-order-add-material>＋ Adicionar insumo</button></details></article>`;
}
function openEditOrder(id){
 const order=state.orders.find(o=>o.id===id);if(!order)return;
 order.stage=normalizeStage(order.stage);
 let items=order.items?.map(i=>({...i,composition:(i.composition||[]).map(x=>({...x}))}));
 if(!items?.length)items=[{id:uid(),name:order.product,qty:Number(order.qty)||1,unitPrice:(Number(order.total)||0)/(Number(order.qty)||1),paidAmount:Number(order.paid)||0,composition:(order.composition||[]).map(x=>({...x}))}];
 document.querySelector('#editOrderBody').innerHTML=`<form id="editOrderForm" data-id="${esc(order.id)}"><div class="order-edit-meta"><div><b>👤 ${esc(order.clientName)}</b><small>Pedido em ${dateBR(order.orderDate||order.date)}</small></div><div class="field"><label>📌 Etapa da produção</label><select name="stage">${PRODUCTION_STAGES.map(st=>`<option value="${esc(st)}" ${order.stage===st?'selected':''}>${esc(st)}</option>`).join('')}</select></div>${field('📅 Data do pedido','orderDate','date','',normalizedBirth(order.orderDate||order.date)||today(),'required')}${field('🚚 Previsão de entrega','due','date','',normalizedBirth(order.due)||'','required')}<div class="field"><label>Tipo de entrega</label><select name="delivery"><option ${order.delivery==='Loja'?'selected':''}>Loja</option><option ${order.delivery==='MotoUber'?'selected':''}>MotoUber</option><option ${order.delivery==='Correios'?'selected':''}>Correios</option></select></div><div class="field"><label>Forma de pagamento</label><select name="payment"><option ${order.payment==='Pix'?'selected':''}>Pix</option><option ${order.payment==='Cartão'?'selected':''}>Cartão</option><option ${order.payment==='Dinheiro'?'selected':''}>Dinheiro</option></select></div><div class="field span-2"><label>📍 Endereço de entrega</label><input name="address" value="${esc(order.address||'')}"></div></div><div class="order-edit-items-head"><h3>Itens do pedido</h3><button type="button" class="btn light" data-order-add-item>＋ Adicionar item</button></div><p class="muted order-edit-help">Para cada item novo, confirme se o valor foi recebido ou ficará a receber. Vincule os insumos usados para atualizar o estoque.</p><div id="orderEditItems">${items.map(i=>orderItemEditor(i)).join('')}</div><div class="order-edit-summary"><div><small>Total do pedido</small><b id="editOrderTotal">R$ 0,00</b></div><div><small>Total recebido</small><b id="editOrderPaid">R$ 0,00</b></div><div><small>A receber</small><b id="editOrderBalance">R$ 0,00</b></div></div><div class="form-actions"><button type="button" class="btn light" onclick="document.querySelector('#editOrderDialog').close()">Cancelar</button><button class="btn primary">Salvar alterações</button></div></form>`;
 document.querySelector('#editOrderForm .form-actions').insertAdjacentHTML('afterbegin','<button type="button" class="btn light" data-order-copy>▧ Gerar cópia para WhatsApp</button>');updateOrderEditSummary();document.querySelector('#editOrderDialog').showModal();
}
function updateOrderEditSummary(){let total=0,paid=0;document.querySelectorAll('.order-edit-item').forEach(row=>{const qty=Number(row.querySelector('.order-item-qty').value)||0,unit=Number(row.querySelector('.order-item-price').value)||0;total+=qty*unit;paid+=Number(row.querySelector('.order-item-paid').value)||0});const balance=total-paid;document.querySelector('#editOrderTotal').textContent=money(total);document.querySelector('#editOrderPaid').textContent=money(paid);document.querySelector('#editOrderBalance').textContent=money(Math.max(0,balance));document.querySelector('#editOrderBalance').classList.toggle('overpaid',balance<0)}
function orderStockUsage(items){const usage=new Map();for(const item of items||[])for(const material of item.composition||[]){const id=material.stockId;if(id)usage.set(id,roundQty((usage.get(id)||0)+(Number(material.qty)||0)*(Number(item.qty)||0)))}return usage}
function existingOrderStockUsage(order){if(order.items?.length)return orderStockUsage(order.items);const usage=new Map();for(const material of order.composition||[])if(material.stockId)usage.set(material.stockId,roundQty((usage.get(material.stockId)||0)+(Number(material.qty)||0)*(Number(order.qty)||1)));return usage}

function buildLocalEntityBackup(st=state){
 const productMap=new Map(),produtos=[];
 const ensureLocalProduct=(name,price=0)=>{
  const n=String(name||'Produto').trim()||'Produto',key=n.toLocaleLowerCase('pt-BR');
  if(!productMap.has(key)){
   const row={id:produtos.length+1,nome:n,nome_normalizado:key,preco_padrao:Number(price)||0,ativo:true};
   produtos.push(row);productMap.set(key,row.id);
  }
  return productMap.get(key);
 };
 const clientes=(st.clients||[]).map(c=>({id:String(c.id),nome:c.name||'',telefone:c.phone||'',nascimento:normalizedBirth(c.birth)||null,endereco:c.address||''}));
 const estoque=(st.stock||[]).map(s=>({id:String(s.id),nome:s.name||'',unidade:s.unit||'un',quantidade:roundQty(s.qty),quantidade_minima:s.minimum==null||s.minimum===''?null:roundQty(s.minimum),custo_unitario:roundCost(s.unitCost)}));
 const compras=[],compra_itens=[];
 for(const p of st.purchases||[]){
  compras.push({id:String(p.id),data_compra:normalizedBirth(p.date)||today(),fornecedor:p.supplier||'',total:Number(p.total)||0});
  for(const item of p.items||[]){
   const q=roundQty(item.qty)||1,cu=roundCost(item.unitCost);
   compra_itens.push({id:compra_itens.length+1,compra_id:String(p.id),estoque_id:item.stockId||null,nome_insumo:item.name||'',quantidade:q,custo_unitario:cu,subtotal:Math.round(q*cu*100)/100});
  }
 }
 const vendas=[],venda_itens=[],venda_item_insumos=[];
 for(const s of st.sales||[]){
  vendas.push({id:String(s.id),data_venda:normalizedBirth(s.date)||today(),data_pedido:normalizedBirth(s.orderDate||s.date)||today(),cliente_id:s.clientId||null,nome_cliente:s.clientName||'Cliente avulso',telefone_cliente:s.clientPhone||'',endereco_entrega:s.address||'',produto_resumo:s.product||'',quantidade:Number(s.qty)||1,total:Number(s.total)||0,recebido:Number(s.paid)||0,custo:Number(s.cost)||0,pagamento:s.payment||'',entrega:s.delivery||'Loja',previsao_entrega:normalizedBirth(s.due)||null});
  const items=s.items?.length?s.items:[{id:uid(),name:s.product||'Produto',qty:Number(s.qty)||1,unitPrice:(Number(s.total)||0)/(Number(s.qty)||1),paidAmount:Number(s.paid)||0,composition:s.composition||[]}];
  for(const item of items){
   const itemId=String(item.id||uid()),pid=ensureLocalProduct(item.name||s.product,item.unitPrice);
   venda_itens.push({id:itemId,venda_id:String(s.id),produto_id:pid,nome_produto:item.name||s.product||'Produto',quantidade:Number(item.qty)||1,preco_unitario:Number(item.unitPrice)||0,recebido:Number(item.paidAmount)||0});
   for(const m of item.composition||[]){
    venda_item_insumos.push({id:venda_item_insumos.length+1,venda_item_id:itemId,estoque_id:m.stockId||null,nome_insumo:m.name||'',quantidade_por_item:roundQty(m.qty),custo_unitario:roundCost(m.unitCost)});
   }
  }
 }
 const controles_da_producao=[],controle_producao_itens=[],controle_item_insumos=[];
 for(const o of st.orders||[]){
  controles_da_producao.push({id:String(o.id),venda_id:o.saleId||null,cliente_id:o.clientId||null,nome_cliente:o.clientName||'Cliente avulso',telefone_cliente:o.clientPhone||'',endereco_entrega:o.address||'',produto_resumo:o.product||'',quantidade:Number(o.qty)||1,total:Number(o.total)||0,recebido:Number(o.paid)||0,custo:Number(o.cost)||0,data_pedido:normalizedBirth(o.orderDate||o.date)||today(),previsao_entrega:normalizedBirth(o.due)||null,tipo_entrega:o.delivery||'Loja',pagamento:o.payment||'',etapa:normalizeStage(o.stage)});
  const items=o.items?.length?o.items:[{id:uid(),name:o.product||'Produto',qty:Number(o.qty)||1,unitPrice:(Number(o.total)||0)/(Number(o.qty)||1),paidAmount:Number(o.paid)||0,composition:o.composition||[]}];
  for(const item of items){
   const itemId=String(item.id||uid()),pid=ensureLocalProduct(item.name||o.product,item.unitPrice);
   controle_producao_itens.push({id:itemId,controle_id:String(o.id),produto_id:pid,nome_produto:item.name||o.product||'Produto',quantidade:Number(item.qty)||1,preco_unitario:Number(item.unitPrice)||0,recebido:Number(item.paidAmount)||0});
   for(const m of item.composition||[]){
    controle_item_insumos.push({id:controle_item_insumos.length+1,controle_item_id:itemId,estoque_id:m.stockId||null,nome_insumo:m.name||'',quantidade_por_item:roundQty(m.qty),custo_unitario:roundCost(m.unitCost)});
   }
  }
 }
 const orcamentos=[],orcamento_insumos=[];
 for(const q of st.quotes||[]){
  orcamentos.push({id:String(q.id),data_orcamento:normalizedBirth(q.date)||today(),data_pedido:normalizedBirth(q.orderDate||q.date)||today(),previsao_entrega:normalizedBirth(q.due)||null,cliente_id:q.clientId||null,nome_cliente:q.clientName||'Cliente avulso',telefone_cliente:q.clientPhone||'',endereco_entrega:q.address||'',nome_produto:q.product||'',nome_composicao:q.compositionName||'',quantidade:Number(q.qty)||1,preco:Number(q.price)||0,custo:Number(q.cost)||0,margem:Number(q.margin)||0,tipo_margem:q.marginMode||'margin',percentual_sinal:Number(q.deposit??50),valor_entrada:q.depositAmount==null?null:Number(q.depositAmount),pagamento:q.payment||'',entrega:q.delivery||'Loja',status:q.status||'Aguardando aprovação',venda_id:q.saleId||null,controle_id:q.orderId||null});
  for(const m of q.composition||[]){
   orcamento_insumos.push({id:orcamento_insumos.length+1,orcamento_id:String(q.id),estoque_id:m.stockId||null,nome_insumo:m.name||'',quantidade:roundQty(m.qty),custo_unitario:roundCost(m.unitCost)});
  }
 }
 const despesas=(st.expenses||[]).map(e=>({id:String(e.id),descricao:e.description||'',valor:Number(e.amount)||0,data_despesa:normalizedBirth(e.date)||today()}));
 const modelos=[],modelo_insumos=[];
 for(const m of st.models||[]){
  modelos.push({id:String(m.id),nome:m.name||''});
  for(const item of m.composition||[]){
   modelo_insumos.push({id:modelo_insumos.length+1,modelo_id:String(m.id),estoque_id:item.stockId||null,nome_insumo:item.name||'',quantidade:roundQty(item.qty),custo_unitario:roundCost(item.unitCost)});
  }
 }
 const configuracoes=[{id:1,negocio:st.settings?.business||'Allegra gráfica & personalizados',telefone:st.settings?.phone||'',endereco:st.settings?.address||'',estoque_baixo:Number(st.settings?.lowStock)||5}];
 const entities={clientes,estoque,produtos,compras,compra_itens,vendas,venda_itens,venda_item_insumos,controles_da_producao,controle_producao_itens,controle_item_insumos,orcamentos,orcamento_insumos,despesas,modelos,modelo_insumos,configuracoes};
 const entityCounts=Object.fromEntries(Object.entries(entities).map(([k,v])=>[k,v.length]));
 return {meta:{system:'Allegra Gestão Pro ERP',format:'allegra-entities-v2',version:'0.4.0',exportedAt:new Date().toISOString(),entityCounts},entities,appState:structuredClone(st)};
}
function rowsToCsvLocal(rows=[]){
 if(!rows.length)return '\uFEFF';
 const headers=Array.from(rows.reduce((set,r)=>{if(r&&typeof r==='object')Object.keys(r).forEach(k=>set.add(k));return set},new Set()));
 const escCell=v=>{if(v==null)return '';const s=typeof v==='object'?JSON.stringify(v):String(v);return /[";\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
 return '\uFEFF'+[headers.map(escCell).join(';'),...rows.map(r=>headers.map(h=>escCell(r?.[h])).join(';'))].join('\r\n');
}
async function exportBackupJson(){
 try{await flushSave()}catch{}
 try{
  const r=await fetch('/api/backup',{headers:authToken?{Authorization:'Bearer '+authToken}:{}});
  if(!r.ok)throw new Error('Fallback local');
  const blob=await r.blob();
  downloadQuoteCopy(blob,`allegra-backup-entidades-${today()}.json`);
  toast('Backup por entidades exportado do banco com sucesso!');
 }catch{
  const backup=buildLocalEntityBackup(state);
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
  downloadQuoteCopy(blob,`allegra-backup-entidades-${today()}.json`);
  toast('Backup por entidades exportado!');
 }
}
async function exportBackupZip(){
 try{await flushSave()}catch{}
 try{
  const r=await fetch('/api/backup/zip',{headers:authToken?{Authorization:'Bearer '+authToken}:{}});
  if(!r.ok){let err={};try{err=await r.json()}catch{}throw new Error(err.error||'Falha ao gerar pacote ZIP no servidor.')}
  const blob=await r.blob();
  downloadQuoteCopy(blob,`allegra-backup-entidades-${today()}.zip`);
  toast('Pacote ZIP com entidades separadas (JSON + CSV) baixado!');
 }catch(e){
  toast('Não foi possível baixar o ZIP do servidor: '+e.message);
 }
}
async function exportSingleEntity(){
 const entity=document.querySelector('#exportEntitySelect')?.value||'clientes';
 const format=document.querySelector('#exportFormatSelect')?.value||'json';
 try{await flushSave()}catch{}
 try{
  const r=await fetch(`/api/backup/entity/${encodeURIComponent(entity)}?format=${encodeURIComponent(format)}`,{headers:authToken?{Authorization:'Bearer '+authToken}:{}});
  if(!r.ok)throw new Error('Fallback local');
  const blob=await r.blob();
  downloadQuoteCopy(blob,`allegra-${entity}-${today()}.${format}`);
  toast(`Entidade "${entity}" exportada em ${format.toUpperCase()}!`);
 }catch{
  const local=buildLocalEntityBackup(state),rows=local.entities[entity]||[];
  if(format==='csv'){
   const blob=new Blob([rowsToCsvLocal(rows)],{type:'text/csv;charset=utf-8'});
   downloadQuoteCopy(blob,`allegra-${entity}-${today()}.csv`);
  }else{
   const payload={meta:{system:'Allegra Gestão Pro ERP',entity,count:rows.length,exportedAt:new Date().toISOString()},records:rows};
   const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
   downloadQuoteCopy(blob,`allegra-${entity}-${today()}.json`);
  }
  toast(`Entidade "${entity}" exportada em ${format.toUpperCase()}!`);
 }
}
async function importBackupFile(inputEl){
 const file=inputEl?.files?.[0];if(!file)return;
 try{
  const text=await file.text();
  const parsed=JSON.parse(text);
  if(!parsed||typeof parsed!=='object')throw new Error('Formato JSON inválido.');
  const isEntityFormat=Boolean(parsed.entities&&typeof parsed.entities==='object');
  const isSingleEntity=Boolean(parsed.meta?.entity&&Array.isArray(parsed.records));
  const isPortugueseRoot=Boolean(Array.isArray(parsed.clientes)||Array.isArray(parsed.estoque)||Array.isArray(parsed.controles_da_producao));
  const isLegacy=Boolean(Array.isArray(parsed.clients)||Array.isArray(parsed.stock)||Array.isArray(parsed.orders)||Array.isArray(parsed.sales));
  if(!isEntityFormat&&!isSingleEntity&&!isPortugueseRoot&&!isLegacy)throw new Error('O arquivo selecionado não contém entidades válidas do Allegra.');
  const replaceAll=!isSingleEntity&&Boolean(document.querySelector('#replaceOnRestore')?.checked);
  if(replaceAll&&!confirm('Confirma substituir todos os dados atuais pelos dados deste arquivo de backup? (Um backup automático do estado atual será salvo no servidor antes da substituição)'))return;
  const res=await api('/backup/restore',{method:'POST',body:JSON.stringify({backup:parsed,replaceAll})});
  if(res?.payload){
   const payload=res.payload;
   state={...defaultState,...payload,clients:(payload.clients||[]).map(c=>({...c,birth:normalizedBirth(c.birth)||''})),orders:(payload.orders||[]).map(o=>({...o,stage:normalizeStage(o.stage)})),settings:{...defaultState.settings,...(payload.settings||{})}};
   persistedState=structuredClone(state);
   persistLocal();
   render();
   toast(`Backup restaurado no banco! (${state.clients.length} clientes, ${state.stock.length} insumos, ${state.orders.length} pedidos, ${state.sales.length} vendas)`);
  }
 }catch(err){
  toast('Falha ao importar backup: '+(err.message||'Arquivo inválido.'));
 }finally{
  inputEl.value='';
 }
}

function action(a,id,value){
 if(a==='quoteForClient'){if(!state.clients.some(c=>c.id===id))return;quoteClientShortcut=id;setPage('quotes');return}
 if(a==='filterDash'){let from=document.querySelector('#dashFrom').value,to=document.querySelector('#dashTo').value;if(from&&to&&from>to){toast('A data inicial deve ser anterior à data final.');return}dashRange={from,to};render();return}
 if(a==='nextStage'){moveOrderStage(id,1);return}
 if(a==='prevStage'){moveOrderStage(id,-1);return}
 if(a==='editOrder'){openEditOrder(id);return}
 if(a==='setDelivery'){let o=state.orders.find(x=>x.id===id);if(o){o.delivery=value;let s=state.sales.find(x=>x.id===o.saleId||x.orderId===o.id);if(s)s.delivery=value;save(true);render()}return}
 if(a==='markOrderPaid'){let o=state.orders.find(x=>x.id===id);if(o){o.paid=Number(o.total)||0;(o.items||[]).forEach(item=>item.paidAmount=item.qty*item.unitPrice);let sale=state.sales.find(s=>s.id===o.saleId||s.orderId===o.id);if(sale){sale.paid=o.paid;if(sale.items)sale.items.forEach(item=>item.paidAmount=item.qty*item.unitPrice)}save(true);render();toast('Encomenda marcada como quitada.')}return}
 if(a==='copyAddress'){let o=state.orders.find(x=>x.id===id),address=o?.address||state.clients.find(c=>c.id===o?.clientId)?.address||'';if(!address){toast('Este pedido não tem endereço cadastrado.');return}if(navigator.clipboard?.writeText)navigator.clipboard.writeText(address).then(()=>toast('Endereço copiado!')).catch(()=>prompt('Copie o endereço:',address));else prompt('Copie o endereço:',address);return}
 if(a==='readyWhatsApp'){let o=state.orders.find(x=>x.id===id),phone=whatsappPhone(o?.clientPhone||state.clients.find(c=>c.id===o?.clientId)?.phone||'');if(!phone){toast('Cadastre o WhatsApp do cliente.');return}const message='Olá!!\nBoa notícia!!!\nSeu pedido está prontinho para retirada.\nLocal: R. Paulo Roberto da Cruz, 58 ( quinta casa da rua ), rua do depósito da Antares, muro alto, Caverazinho.\nCaso tenha solicitado entrega via motoboy, combinaremos a data e horário para enviarmos. ♥';window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank');return}
 if(a==='orderWhatsApp'){let o=state.orders.find(x=>x.id===id),phone=whatsappPhone(o?.clientPhone||state.clients.find(c=>c.id===o?.clientId)?.phone||'');if(phone)window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Olá, ${o.clientName}! Seu pedido ${o.product} está em produção. Previsão de entrega: ${dateBR(o.due)}.`)}`,'_blank');else toast('Cadastre o WhatsApp do cliente.');return}
 if(a==='receipt'){let s=state.sales.find(x=>x.id===id),items=s.items?.length?s.items.map(i=>`${esc(i.qty)}× ${esc(i.name)} — ${money(i.qty*i.unitPrice)}`).join('<br>'):`${esc(s.qty)}× ${esc(s.product)}`;document.querySelector('#receiptBody').innerHTML=`<div class="receipt"><h2>${esc(state.settings.business)}</h2><p><b>RECIBO DE PAGAMENTO</b><br>Data: ${dateBR(s.date)}<br>Cliente: ${esc(s.clientName)}<br>Itens:<br>${items}<br>Pagamento: ${esc(s.payment)}<br><b>Valor: ${money(s.total)}</b></p><p>Obrigado pela preferência!</p></div>`;document.querySelector('#receiptDialog').showModal();return}
 if(a==='approveQuote'){let q=state.quotes.find(x=>x.id===id);if(!q||q.status==='Aprovado')return;let confirmed=recordConfirmedSale({clientId:q.clientId,clientName:q.clientName,clientPhone:q.clientPhone,address:q.address,product:q.product,qty:q.qty,total:q.price,payment:q.payment,deposit:q.deposit??50,depositAmount:q.depositAmount,orderDate:q.orderDate,due:q.due,delivery:q.delivery,composition:q.composition||[]});if(!confirmed)return;q.status='Aprovado';q.saleId=state.sales[state.sales.length-1].id;q.orderId=state.orders[state.orders.length-1].id;save(true);render();toast('Venda confirmada e enviada para Criação de Arte.');return}
 if(a==='birthday'){let c=state.clients.find(x=>x.id===id),phone=whatsappPhone(c?.phone);if(phone)window.open(`https://wa.me/${phone}?text=${encodeURIComponent('Feliz aniversário! 🎉 Que seu dia seja especial. Com carinho, Allegra!')}`,'_blank');else toast('Cadastre o WhatsApp do cliente.');return}
 if(a==='editClient'){let c=state.clients.find(x=>x.id===id);if(!c)return;document.querySelector('#clientEditBody').innerHTML=`<form id="editClientForm" data-id="${esc(c.id)}" class="form-grid">${field('Nome completo','name','text','',c.name,'required')}${field('WhatsApp / telefone','phone','tel','',c.phone||'')}${field('Data de nascimento','birth','date','',c.birth||'')}${field('Endereço completo','address','text','',c.address||'')}<div class="form-actions span-2"><button type="button" class="btn light" onclick="document.querySelector('#clientDialog').close()">Cancelar</button><button class="btn primary">Salvar alterações</button></div></form>`;document.querySelector('#clientDialog').showModal();return}
 if(a==='deleteClient'&&confirm('Excluir este cliente?'))state.clients=state.clients.filter(x=>x.id!==id);
 if(a==='deleteQuoteModel'){let selected=document.querySelector('#quoteModelSelect')?.value;if(!selected){toast('Selecione um modelo salvo para excluir.');return}if(confirm('Excluir o modelo selecionado?')){state.models=state.models.filter(x=>x.id!==selected);save(true);render();toast('Modelo excluído.')}return}
 if(a==='deleteStock'&&confirm('Excluir este insumo?'))state.stock=state.stock.filter(x=>x.id!==id);
 if(a==='deleteExpense')state.expenses=state.expenses.filter(x=>x.id!==id);
 if(a==='editStockQty'){let s=state.stock.find(x=>x.id===id);if(!s)return;let input=prompt(`Informe a quantidade disponível para ${s.name}:`,String(s.qty));if(input===null)return;let q=Number(input.trim().replace(',','.'));if(!input.trim()||!Number.isFinite(q)||q<0){toast('Informe uma quantidade válida, igual ou maior que zero.');return}s.qty=roundQty(q);save(true);render();toast('Quantidade de estoque atualizada!');return}
 if(a==='openPurchase'){openPurchaseDialog();return}
 if(a==='stockMove'){let s=state.stock.find(x=>x.id===id),kind=prompt('Digite E para entrada ou S para saída:','E'),q=Number(prompt('Quantidade:','1'));if(s&&q>0){let next=roundQty(s.qty+(kind?.toUpperCase()==='E'?q:-q));if(Number(s.qty)+(kind?.toUpperCase()==='E'?q:-q)<0){s.qty=0;toast('Estoque não pode ficar negativo.')}else s.qty=next}}
 if(a==='export'){exportBackupJson();return}
 if(a==='exportZip'){exportBackupZip();return}
 if(a==='exportEntity'){exportSingleEntity();return}
 if(a==='reset'){if(confirm('Tem certeza? Esta ação apaga todos os dados cadastrados.')){state=structuredClone(defaultState);save(true);render()}return}
 save(true);render();
}
document.addEventListener('submit',e=>{
 e.preventDefault();let f=e.target,d=formData(f);
 if(f.id==='clientForm'){state.clients.push({id:uid(),...d,birth:normalizedBirth(d.birth)||''});toast('Cliente cadastrado!')}
 if(f.id==='bulkClientForm'){
  let added=0,updated=0,skipped=0;
  for(const line of d.rows.split(/\r?\n/)){
   if(!line.trim())continue;
   const parts=line.split(';').map(x=>x.trim());
   if(parts.length<2||!parts[0]){skipped++;continue}
   const [name,phone='',birthRaw='',address='']=parts,phoneKey=normalizedPhone(phone),birth=normalizedBirth(birthRaw);
   if(birth===null){skipped++;continue}
   const existing=phoneKey?state.clients.find(c=>normalizedPhone(c.phone)===phoneKey):null;
   if(existing){existing.name=name; if(phone)existing.phone=phone; if(birth)existing.birth=birth; if(address)existing.address=address; updated++}
   else{state.clients.push({id:uid(),name,phone,birth,address});added++}
  }
  save(true);render();toast(`${added} criado(s), ${updated} atualizado(s)${skipped?`, ${skipped} linha(s) ignorada(s)`:''}.`);return;
 }
 if(f.id==='editClientForm'){let c=state.clients.find(x=>x.id===f.dataset.id);if(!c)return;c.name=d.name.trim();c.phone=d.phone.trim();c.birth=normalizedBirth(d.birth)||'';c.address=d.address.trim();save(true);document.querySelector('#clientDialog').close();render();toast('Cadastro do cliente atualizado!');return}
 if(f.id==='editOrderForm'){
  const order=state.orders.find(o=>o.id===f.dataset.id);if(!order)return;
  const rows=[...document.querySelectorAll('.order-edit-item')],items=[];
  for(const row of rows){
   const name=row.querySelector('.order-item-name').value.trim(),qty=Number(row.querySelector('.order-item-qty').value),unitPrice=Number(row.querySelector('.order-item-price').value),paidAmount=Number(row.querySelector('.order-item-paid').value),status=row.querySelector('.order-item-status').value;
   if(!name||!Number.isFinite(qty)||qty<=0||!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(paidAmount)||paidAmount<0||paidAmount>qty*unitPrice+0.009||!status){toast('Confira os itens e confirme se cada valor foi recebido ou está a receber.');return}
   const composition=[];for(const materialRow of row.querySelectorAll('.order-material-row')){const stockId=materialRow.querySelector('.order-material-stock').value,materialQty=Number(materialRow.querySelector('.order-material-qty').value),stock=state.stock.find(s=>s.id===stockId);if(!stock||!Number.isFinite(materialQty)||materialQty<=0){toast('Confira os insumos vinculados aos itens.');return}composition.push({stockId:stock.id,name:stock.name,qty:roundQty(materialQty),unitCost:roundCost(stock.unitCost)})}
   items.push({id:row.dataset.itemId||uid(),name,qty,unitPrice,paidAmount,composition});
  }
  if(!items.length){toast('O pedido precisa ter pelo menos um item.');return}
  const total=items.reduce((sum,item)=>sum+item.qty*item.unitPrice,0),paid=items.reduce((sum,item)=>sum+item.paidAmount,0);if(paid>total+0.009){toast('O valor recebido não pode ser maior que o total do pedido.');return}
  const previous=existingOrderStockUsage(order),next=orderStockUsage(items),ids=new Set([...previous.keys(),...next.keys()]);
  for(const stockId of ids){const delta=roundQty((next.get(stockId)||0)-(previous.get(stockId)||0)),stock=state.stock.find(s=>s.id===stockId);if(delta>0&&!stock){toast('Um insumo usado neste pedido não está mais cadastrado.');return}if(delta>0&&Number(stock.qty)<delta){toast(`Estoque insuficiente de ${stock.name}: disponível ${stock.qty}, necessário ${delta}.`);return}}
  for(const stockId of ids){const delta=(next.get(stockId)||0)-(previous.get(stockId)||0),stock=state.stock.find(s=>s.id===stockId);if(stock&&delta)stock.qty=roundQty(Number(stock.qty)-delta)}
  const cost=Math.round([...next.entries()].reduce((sum,[stockId,qty])=>sum+qty*(Number(state.stock.find(s=>s.id===stockId)?.unitCost)||0),0)*100)/100,product=items.map(item=>item.name).join(', '),quantity=items.reduce((sum,item)=>sum+item.qty,0),composition=[...next.entries()].map(([stockId,qty])=>{const stock=state.stock.find(s=>s.id===stockId);return {stockId,name:stock?.name||'',qty:roundQty(qty),unitCost:roundCost(stock?.unitCost)}});
  const nextStage=normalizeStage(d.stage||order.stage);
  const normOrderDate=normalizedBirth(d.orderDate)||today(),normDue=normalizedBirth(d.due)||'';
  Object.assign(order,{stage:nextStage,orderDate:normOrderDate,date:normOrderDate,due:normDue,delivery:d.delivery,payment:d.payment,address:d.address.trim(),items,product,qty:quantity,total,paid,cost,composition});
  const sale=state.sales.find(s=>s.id===order.saleId||s.orderId===order.id);if(sale)Object.assign(sale,{orderDate:normOrderDate,due:normDue,delivery:d.delivery,payment:d.payment,address:d.address.trim(),items:items.map(item=>({...item,id:uid(),composition:item.composition.map(x=>({...x}))})),product,qty:quantity,total,paid,cost,composition:composition.map(x=>({...x}))});
  const quote=state.quotes.find(q=>q.orderId===order.id||q.saleId===sale?.id);if(quote)Object.assign(quote,{orderDate:normOrderDate,due:normDue,delivery:d.delivery,payment:d.payment,address:d.address.trim(),product,qty:quantity,price:total,cost,composition:composition.map(x=>({...x}))});
  save(true);document.querySelector('#editOrderDialog').close();render();toast('Pedido, status, pagamento e estoque atualizados!');return;
 }
 if(f.id==='stockForm'){let pack=Number(d.packQty)||1;state.stock.push({id:uid(),name:d.name,unit:'un',qty:roundQty(d.qty),minimum:null,unitCost:roundCost((Number(d.packPrice)||0)/pack)});toast('Insumo cadastrado!')}
 if(f.id==='expenseForm'){state.expenses.push({id:uid(),...d,date:normalizedBirth(d.date)||today(),amount:Number(d.amount)});toast('Despesa cadastrada!')}
 if(f.id==='settingsForm'){state.settings={...state.settings,...d,lowStock:Number(d.lowStock)||5};toast('Configurações salvas!')}
 if(f.id==='purchaseForm'){
  const lines=[...document.querySelectorAll('.purchase-line')].map(row=>({stockId:row.querySelector('.purchase-stock').value,qty:roundQty(row.querySelector('.purchase-qty').value),unitCost:roundCost(row.querySelector('.purchase-cost').value)}));
  if(!lines.length||lines.some(x=>!x.stockId||!Number.isFinite(x.qty)||x.qty<=0||!Number.isFinite(x.unitCost)||x.unitCost<0)){toast('Confira os insumos, as quantidades e os custos da compra.');return}
  const items=lines.map(line=>{const stock=state.stock.find(s=>s.id===line.stockId),oldQty=Number(stock.qty)||0,oldCost=Number(stock.unitCost)||0;stock.qty=roundQty(oldQty+line.qty);stock.unitCost=roundCost(((oldQty*oldCost)+(line.qty*line.unitCost))/stock.qty);return {...line,name:stock.name}}),purchase={id:uid(),date:normalizedBirth(d.date)||today(),supplier:d.supplier.trim(),items,total:Math.round(items.reduce((sum,x)=>sum+x.qty*x.unitCost,0)*100)/100};
  state.purchases||=[];state.purchases.push(purchase);save(true);document.querySelector('#purchaseDialog').close();render();toast('Compra registrada e estoque atualizado!');return;
 }
 if(f.id==='quickStockForm'){
  const name=d.name.trim(),unitCost=roundCost(d.unitCost);if(!name||!Number.isFinite(unitCost)||unitCost<0){toast('Informe nome e custo unitário válidos.');return}
  let stock=state.stock.find(s=>s.name.trim().toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));
  if(!stock){stock={id:uid(),name,unit:'un',qty:0,minimum:null,unitCost};state.stock.push(stock);state.stock.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));document.querySelectorAll('.purchase-stock').forEach(select=>{const option=document.createElement('option');option.value=stock.id;option.textContent=`${stock.name} (atual: ${stock.qty})`;select.append(option)})}
  const row=document.querySelector(`[data-line="${purchaseQuickRow}"]`);if(row){row.querySelector('.purchase-stock').value=stock.id;row.querySelector('.purchase-cost').value=unitCost}
  save(true);document.querySelector('#quickStockDialog').close();updatePurchaseTotal();toast('Insumo vinculado. A compra continua preenchida.');return;
 }
 if(f.id==='quoteForm'){let c=state.clients.find(x=>x.id===d.clientId),values=quoteNumbers(),q={id:uid(),date:today(),...d,orderDate:normalizedBirth(d.orderDate)||today(),due:normalizedBirth(d.due)||'',compositionName:document.querySelector('#compositionName').value.trim(),qty:values.qty,price:values.price,cost:values.cost,margin:values.rate,marginMode:values.mode,deposit:values.depositRate,depositAmount:values.depositAmount,clientName:c?.name||'Cliente avulso',clientPhone:c?.phone||'',status:'Aguardando aprovação',composition:composition.slice()};state.quotes.push(q);toast('Orçamento gerado!');composition=[]}
 save(true);render();
});
document.addEventListener('change',e=>{
 if(e.target.id==='importFile'){importBackupFile(e.target);return}
 if(e.target.id==='quoteClient'){let option=e.target.selectedOptions[0];document.querySelector('#quoteAddress').value=option?.dataset.address||''}
});
document.addEventListener('input',e=>{if(e.target.id==='clientSearch'||e.target.id==='stockSearch'){let q=e.target.value.toLowerCase();document.querySelectorAll(e.target.id==='clientSearch'?'#clientRows tr':'#stockRows tr').forEach(r=>r.style.display=(r.dataset.search||'').includes(q)?'':'none')}});
document.addEventListener('input',e=>{if(e.target.id==='customDeposit'){let manual=document.querySelector('#quoteForm input[name="deposit"][value="manual"]');if(manual)manual.checked=true}if(e.target.closest('#quoteForm'))recalcQuote()});
document.addEventListener('change',e=>{if(e.target.closest('#quoteForm'))recalcQuote()});
document.addEventListener('input',e=>{if(e.target.closest('#purchaseForm'))updatePurchaseTotal()});
document.addEventListener('change',e=>{if(e.target.matches('.purchase-stock')){let stock=state.stock.find(s=>s.id===e.target.value),row=e.target.closest('.purchase-line');if(stock&&row)row.querySelector('.purchase-cost').value=stock.unitCost}if(e.target.closest('#purchaseForm'))updatePurchaseTotal()});
document.addEventListener('input',e=>{if(e.target.closest('#editOrderForm')){let row=e.target.closest('.order-edit-item');if(row&&(e.target.matches('.order-item-qty')||e.target.matches('.order-item-price'))){let status=row.querySelector('.order-item-status').value,total=(Number(row.querySelector('.order-item-qty').value)||0)*(Number(row.querySelector('.order-item-price').value)||0);if(status==='received')row.querySelector('.order-item-paid').value=total.toFixed(2);if(status==='due')row.querySelector('.order-item-paid').value='0'}updateOrderEditSummary()}});
document.addEventListener('change',e=>{if(e.target.matches('.order-item-status')){let row=e.target.closest('.order-edit-item'),total=(Number(row.querySelector('.order-item-qty').value)||0)*(Number(row.querySelector('.order-item-price').value)||0),paid=row.querySelector('.order-item-paid');if(e.target.value==='received')paid.value=total.toFixed(2);if(e.target.value==='due')paid.value='0';if(e.target.value==='partial'&&Number(paid.value)>=total)paid.value=Math.max(0,total-0.01).toFixed(2);updateOrderEditSummary()}if(e.target.closest('#editOrderForm')&&e.target.matches('.order-item-paid'))updateOrderEditSummary()});
document.addEventListener('click',e=>{
 const addPurchase=e.target.closest('[data-purchase-add]'),removePurchase=e.target.closest('[data-purchase-remove]'),newPurchaseItem=e.target.closest('[data-purchase-new]');
 if(addPurchase){addPurchaseLine();return}
 if(removePurchase){document.querySelector(`[data-line="${removePurchase.dataset.purchaseRemove}"]`)?.remove();updatePurchaseTotal();return}
 if(newPurchaseItem){purchaseQuickRow=newPurchaseItem.dataset.purchaseNew;document.querySelector('#quickStockForm').reset();document.querySelector('#quickStockDialog').showModal();return}
 if(e.target.closest('#generateQuoteCopy')){generateQuoteCopy();return}
 if(e.target.closest('[data-order-copy]')){generateOrderEditCopy();return}
 const addOrderItem=e.target.closest('[data-order-add-item]'),removeOrderItem=e.target.closest('[data-order-remove-item]'),addOrderMaterial=e.target.closest('[data-order-add-material]'),removeOrderMaterial=e.target.closest('[data-order-remove-material]');
 if(addOrderItem){document.querySelector('#orderEditItems').insertAdjacentHTML('beforeend',orderItemEditor({name:'',qty:1,unitPrice:0,paidAmount:0,composition:[]},true));updateOrderEditSummary();return}
 if(removeOrderItem){let row=removeOrderItem.closest('.order-edit-item'),paid=Number(row.querySelector('.order-item-paid').value)||0;if(paid>0&&!confirm(`Este item tem ${money(paid)} recebido. Ao remover, esse valor também será retirado do total recebido. Confirmar?`))return;row.remove();updateOrderEditSummary();return}
 if(addOrderMaterial){addOrderMaterial.closest('.order-edit-item').querySelector('.order-material-list').insertAdjacentHTML('beforeend',orderMaterialRow());return}
 if(removeOrderMaterial){removeOrderMaterial.closest('.order-material-row').remove();return}
 if(e.target.id==='addMaterial'){let id=document.querySelector('#materialSelect').value,s=state.stock.find(x=>x.id===id),qty=roundQty(document.querySelector('#materialQty').value);if(!s){toast('Cadastre ou selecione um insumo.');return}if(!Number.isFinite(qty)||qty<=0){toast('Informe uma quantidade válida para o insumo.');return}composition.push({id:uid(),stockId:s.id,name:s.name,qty,unitCost:s.unitCost});recalcQuote()}
 if(e.target.id==='saveModel'){let name=document.querySelector('#compositionName').value.trim()||document.querySelector('#quoteForm').elements.product.value.trim();if(!name){toast('Informe o nome da composição para salvar.');return}if(!composition.length){toast('Adicione ao menos um insumo à composição.');return}let model={id:uid(),name,composition:composition.map(x=>({...x,id:x.id||uid()}))};state.models.push(model);let option=document.createElement('option');option.value=model.id;option.textContent=model.name;document.querySelector('#quoteModelSelect').append(option);document.querySelector('#quoteModelSelect').value=model.id;save(true);toast('Modelo salvo!')}
 if(e.target.id==='loadQuoteModel'){let model=state.models.find(x=>x.id===document.querySelector('#quoteModelSelect').value);if(!model){toast('Selecione um modelo salvo.');return}composition=(model.composition||[]).map(x=>({...x,id:x.id||uid()}));document.querySelector('#compositionName').value=model.name;recalcQuote();toast('Modelo carregado!')}
 if(e.target.id==='launchSale'){let f=document.querySelector('#quoteForm'),d=formData(f),values=quoteNumbers(),c=state.clients.find(x=>x.id===d.clientId),total=values.price;if(!d.product||!total||!d.orderDate||!d.due){toast('Preencha a encomenda, a data do pedido, a previsão de entrega e o preço.');return}if(!recordConfirmedSale({clientId:d.clientId,clientName:c?.name,clientPhone:c?.phone,address:d.address,product:d.product,qty:values.qty,total,payment:d.payment,deposit:values.depositRate,depositAmount:values.depositAmount,orderDate:d.orderDate,due:d.due,delivery:d.delivery,composition:composition.slice()}))return;toast('Venda lançada e enviada para Criação de Arte!');save(true);composition=[];render()}
});
initIntranet();

window.signOut=signOut;
