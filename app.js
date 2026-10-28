/* ════════════════════════════════════════════════════════════════
   Organizador de Demandas — Prometals
   App estático (GitHub Pages) + Supabase (login, banco e tempo real)
   ════════════════════════════════════════════════════════════════ */
(() => {
"use strict";

/* ---------- constantes ---------- */
const CARD_TABS = ["lembretes", "dia", "terceiros"];
const TABS = ["rotina", "lembretes", "dia", "terceiros", "calendario"];
const NOMES = { rotina: "Rotina", lembretes: "Lembretes", dia: "Demandas do dia", terceiros: "Demandas de terceiros", enviados: "Enviadas por mim", calendario: "Calendário" };
const PRIOS = ["alta", "media", "baixa"];
const PRIO_RANK = { alta: 0, media: 1, baixa: 2 };
const PRIO_NOME = { alta: "Alta", media: "Média", baixa: "Baixa" };
const prioOf = (v) => PRIOS.includes(v) ? v : "media";
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const MESES_LONGOS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const SEMANA = ["dom","seg","ter","qua","qui","sex","sáb"];

const CFG = window.ORGANIZADOR_CONFIG || {};
const html = document.documentElement;
const $ = (s) => document.querySelector(s);
const now0 = new Date();

const S = {
  me: null, perfis: {},
  data: { lembretes: null, dia: null, terceiros: null, enviados: null },
  active: "dia", visible: TABS.slice(),
  pending: 0, today: localISO(),
  hold: false, dirty: new Set(), drag: null, suppressClick: false, ed: null,
  cal: { y: now0.getFullYear(), m: now0.getMonth(), sel: localISO() },
  diaDate: localISO(), channel: null, reloadTimer: null
};

function storeGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v){ try { localStorage.setItem(k, v); } catch {} }

/* ---------- datas ---------- */
function pad(n){ return String(n).padStart(2, "0"); }
function localISO(d = new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseDay(iso){ const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); }
function daysBetween(a, b){ return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
function fmtShort(iso){ const d = parseDay(iso); return `${d.getDate()} ${MESES[d.getMonth()]}`; }
function hm(ts){ return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function dayOf(ts){ return localISO(new Date(ts)); }
function when(ts){
  const diff = daysBetween(dayOf(ts), S.today);
  if (diff === 0) return `hoje, ${hm(ts)}`;
  if (diff === 1) return `ontem, ${hm(ts)}`;
  return fmtShort(dayOf(ts));
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function longDay(iso){ return cap(parseDay(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })); }
function setToday(){ $("#today").textContent = cap(new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })); }
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* ---------- Supabase ---------- */
// Tolera valores colados com o nome da variável na frente (ex.: "NEXT_PUBLIC_SUPABASE_URL=https://…").
const limpa = (v) => String(v || "").trim().replace(/^[A-Z0-9_]+=/, "").replace(/^["']|["']$/g, "").trim();
CFG.supabaseUrl = limpa(CFG.supabaseUrl); CFG.supabaseAnonKey = limpa(CFG.supabaseAnonKey);
const configured = /^https:\/\/.+/.test(CFG.supabaseUrl) && !/SEU-PROJETO/.test(CFG.supabaseUrl) && CFG.supabaseAnonKey && !/COLE-AQUI/.test(CFG.supabaseAnonKey);
let sb = null;
try { sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null; }
catch (e){ console.error(e); sb = null; }

async function q(promise){ const { data, error } = await promise; if (error) throw error; return data; }

const byCreated = (a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "");
const byDoneDesc = (a, b) => (b.feitoEm || "").localeCompare(a.feitoEm || "");
const byDoneAsc = (a, b) => (a.feitoEm || "").localeCompare(b.feitoEm || "");
const byPrio = (a, b) => PRIO_RANK[a.prioridade] - PRIO_RANK[b.prioridade];
const isPedidoTab = (tab) => tab === "terceiros" || tab === "enviados";

function rowToCard(r){
  return { tab: r.aba, id: r.id, key: `${r.aba}|${r.id}`, texto: r.texto || "", notas: r.notas || "",
    quando: r.quando || null, prioridade: prioOf(r.prioridade), feito: !!r.feito, feitoEm: r.feito_em || null,
    criadoEm: r.criado_em || null, arquivado: !!r.arquivado, pedido: r.pedido || null,
    anexos: Array.isArray(r.anexos) ? r.anexos : [], recorrencia: r.recorrencia || null };
}
function rowToPedido(r, tab){
  return { tab, id: r.id, key: `${tab}|${r.id}`, de: r.de, para: r.para, texto: r.texto || "", notas: r.notas || "",
    quando: null, prioridade: prioOf(r.prioridade), feito: !!r.feito, feitoEm: r.feito_em || null,
    criadoEm: r.criado_em || null, arquivado: !!r.arquivado_para, anexos: Array.isArray(r.anexos) ? r.anexos : [] };
}
const COLS = { texto: "texto", notas: "notas", quando: "quando", prioridade: "prioridade", feito: "feito",
  feitoEm: "feito_em", arquivado: "arquivado", aba: "aba", pedido: "pedido", removido: "removido_para" };
function toRow(patch, pedido){
  const r = {};
  for (const [k, v] of Object.entries(patch)){
    if (pedido && k === "arquivado") r.arquivado_para = v;
    else r[COLS[k] || k] = v;
  }
  return r;
}
function cardRow(i){
  return { id: i.id, aba: i.tab, texto: i.texto, notas: i.notas || "", quando: i.quando, prioridade: i.prioridade,
    feito: i.feito, feito_em: i.feitoEm, arquivado: !!i.arquivado, pedido: i.pedido, criado_em: i.criadoEm, anexos: i.anexos || [], recorrencia: i.recorrencia || null };
}

async function loadPerfis(){
  const rows = await q(sb.from("perfis").select("id,nome,email").order("nome"));
  S.perfis = Object.fromEntries(rows.map(r => [r.id, r]));
  fillParaSelect();
}
async function loadCards(){
  const rows = await q(sb.from("cards").select("*").eq("dono", S.me.id).order("criado_em"));
  const all = rows.map(rowToCard);
  S.data.lembretes = all.filter(i => i.tab === "lembretes");
  S.data.dia = all.filter(i => i.tab === "dia");
}
async function loadPedidos(){
  const id = S.me.id;
  const rows = await q(sb.from("pedidos").select("*").or(`de.eq.${id},para.eq.${id}`).order("criado_em"));
  S.data.terceiros = rows.filter(r => r.para === id && !r.removido_para).map(r => rowToPedido(r, "terceiros"));
  S.data.enviados = rows.filter(r => r.de === id).map(r => rowToPedido(r, "enviados"));
  const unknown = rows.some(r => !S.perfis[r.de] || !S.perfis[r.para]);
  if (unknown) await loadPerfis();
}
/* ---------- demandas recorrentes ---------- */
S.recs = []; S.recsOff = false;
async function loadRecorrencias(){
  const { data, error } = await sb.from("recorrencias").select("*").eq("dono", S.me.id).order("criado_em");
  if (error){ S.recs = []; S.recsOff = true; return; }
  S.recsOff = false;
  S.recs = data.map(r => ({ id: r.id, texto: r.texto, notas: r.notas || "", prioridade: prioOf(r.prioridade), frequencia: r.frequencia,
    dias: Array.isArray(r.dias_semana) ? r.dias_semana : [], diaMes: r.dia_mes || null, inicio: r.inicio, fim: r.fim || null, ultima: r.ultima_gerada || null }));
}
function ocorreEm(rec, iso){
  if (iso < rec.inicio || (rec.fim && iso > rec.fim)) return false;
  const d = parseDay(iso), wd = d.getDay();
  if (rec.frequencia === "diaria") return true;
  if (rec.frequencia === "uteis") return wd >= 1 && wd <= 5;
  if (rec.frequencia === "semanal") return rec.dias.includes(wd);
  if (rec.frequencia === "mensal"){
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(rec.diaMes || 1, ultimo);
  }
  return false;
}
const DIAS_NOME = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function listaPt(a){ return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " e " + a[a.length - 1]; }
function descRec(rec){
  const f = rec.frequencia === "diaria" ? "Todo dia" : rec.frequencia === "uteis" ? "Dias úteis (seg a sex)"
    : rec.frequencia === "semanal" ? "Toda " + listaPt([...rec.dias].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DIAS_NOME[d]))
    : `Todo dia ${rec.diaMes} do mês`;
  const per = rec.fim ? `de ${fmtShort(rec.inicio)} a ${fmtShort(rec.fim)}` : rec.inicio > S.today ? `a partir de ${fmtShort(rec.inicio)}` : "sem data para acabar";
  return `${f} · ${per}`;
}
const recAtiva = (rec) => !rec.fim || rec.fim >= S.today;
// Cria o card de hoje de cada recorrência (uma vez por dia; excluir o card não faz ele voltar).
const tentouGerar = new Set();
async function gerarRecorrencias(){
  const T = S.today;
  const pend = S.recs.filter(r => (!r.ultima || r.ultima < T) && ocorreEm(r, T) && !tentouGerar.has(r.id + T));
  if (!pend.length) return false;
  pend.forEach(r => tentouGerar.add(r.id + T));
  try {
    const rows = pend.map(r => ({ aba: "dia", texto: r.texto, notas: r.notas, prioridade: r.prioridade, quando: T, recorrencia: r.id }));
    await q(sb.from("cards").upsert(rows, { onConflict: "recorrencia,quando", ignoreDuplicates: true }));
    await q(sb.from("recorrencias").update({ ultima_gerada: T }).in("id", pend.map(r => r.id)));
    pend.forEach(r => { r.ultima = T; });
    await loadCards();
    return true;
  } catch (e){ console.warn(e); return false; }
}
const recDe = (i) => i && i.recorrencia ? S.recs.find(r => r.id === i.recorrencia) || null : null;
// Card de recorrência de um dia que já passou não acumula: fica registrado só naquele dia.
const vencidoRec = (i, iso) => !!i.recorrencia && !!i.quando && i.quando < iso;

// Lembretes com data entram sozinhos nas Demandas do dia quando a data chega.
const tentouMover = new Set();
async function autoMoveLembretes(){
  const ids = (S.data.lembretes || []).filter(i => !i.feito && i.quando && i.quando <= S.today && !tentouMover.has(i.id)).map(i => i.id);
  if (!ids.length) return;
  ids.forEach(id => tentouMover.add(id));
  try { await q(sb.from("cards").update({ aba: "dia" }).in("id", ids)); await loadCards(); }
  catch (e){ console.warn(e); }
}
async function reloadAll(){
  try {
    await Promise.all([loadCards(), loadPedidos(), loadRecorrencias()]);
    await autoMoveLembretes();
    await gerarRecorrencias();
    renderAll(); syncEditor();
    $("#banner").hidden = true;
  } catch (e){
    console.warn(e);
    showBanner("Não foi possível carregar as demandas. Verifique a conexão; a página tenta de novo sozinha.");
  }
}
function scheduleReload(){ clearTimeout(S.reloadTimer); S.reloadTimer = setTimeout(reloadAll, 150); }

/* ---------- gravação ---------- */
function errMsg(e){
  const m = (e && (e.message || "")) + "";
  if (/row-level security|permission|42501/i.test(m + (e && e.code))) return "Você não tem permissão para fazer isso.";
  if (/Só quem|Não é permitido|Use seu e-mail/.test(m)) return m;
  if (/Bucket not found|anexos/i.test(m)) return "Os anexos ainda não foram ativados no Supabase. Rode o arquivo atualizacao-1-anexos.sql (veja o README).";
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return "Arquivo grande demais. O limite é 10 MB.";
  if (/fetch|network|Failed/i.test(m)) return "Sem conexão. Verifique a internet e tente de novo.";
  return "Não foi possível salvar. Tente de novo.";
}
function setSync(state){
  const labels = { ok: "Salvo", saving: "Salvando…", off: "Sem conexão", wait: "Conectando…" };
  $("#sync").dataset.state = state; $("#sync-text").textContent = labels[state];
}
function setPending(n){ S.pending += n; setSync(S.pending > 0 ? "saving" : "ok"); }
async function write(fn){
  if (!sb || !S.me) return false;
  setPending(1);
  try { await fn(); scheduleReload(); return true; }
  catch (e){ console.warn(e); toast(errMsg(e)); return false; }
  finally { setPending(-1); }
}
function applyLocal(i, patch){
  const live = findItem(i.key);
  if (live) Object.assign(live, patch);
  if (S.ed && S.ed.key === i.key) Object.assign(S.ed.item, patch);
  renderAll();
}
async function patchItem(i, patch){
  const pedido = isPedidoTab(i.tab);
  await q(sb.from(pedido ? "pedidos" : "cards").update(toRow(patch, pedido)).eq("id", i.id));
  if (!("aba" in patch) && !("removido" in patch)) applyLocal(i, patch);
}
function showBanner(text){ const b = $("#banner"); b.hidden = false; b.textContent = text; }

/* ---------- aviso flutuante ---------- */
let toastTimer, toastHideTimer;
function toast(msg, action){
  const t = $("#toast"), b = $("#toast-btn");
  $("#toast-msg").textContent = msg;
  if (action){ b.hidden = false; b.textContent = action.label; b.onclick = () => { hideToast(); action.run(); }; }
  else { b.hidden = true; b.onclick = null; }
  clearTimeout(toastHideTimer); t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, action ? 6500 : 4500);
}
function hideToast(){ const t = $("#toast"); t.classList.remove("show"); toastHideTimer = setTimeout(() => { t.hidden = true; }, 200); }

/* ---------- elementos ---------- */
const ICON = {
  check: '<svg viewBox="0 0 16 16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  grip: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg>'
};
const AV_CORES = ["#20527c", "#4b2d73", "#1d5a3d", "#704010", "#5b1d1d", "#a17a10"];
function el(tag, cls, text){ const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function nomeDe(id){ const p = S.perfis[id]; return (p && (p.nome || p.email)) || "Colega"; }
function avatarEl(id){
  const a = el("span", "avatar", (nomeDe(id).trim()[0] || "?").toUpperCase());
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  a.style.setProperty("--av", AV_CORES[h % AV_CORES.length]);
  a.setAttribute("aria-hidden", "true");
  return a;
}
function whoEl(id, prefix){
  const who = el("span", "who");
  who.append(avatarEl(id), el("span", null, (prefix ? prefix + " " : "") + (id === S.me.id ? "você" : nomeDe(id))));
  return who;
}
function chipEl(c){ return el("span", "chip" + (c.kind ? " chip-" + c.kind : ""), c.text); }
function prioEl(p){
  const s = el("span", "prio"); s.dataset.p = p; s.title = "Prioridade " + PRIO_NOME[p].toLowerCase();
  s.append(el("i"), el("span", null, PRIO_NOME[p]));
  return s;
}
function markAlta(tab, pend){
  const n = pend.filter(i => i.prioridade === "alta").length, t = $("#tab-" + tab);
  t.classList.toggle("has-alta", n > 0);
  if (n) t.title = `${n} ${n === 1 ? "demanda" : "demandas"} de prioridade alta`; else t.removeAttribute("title");
}
function dueChip(q, feito){
  const d = daysBetween(S.today, q);
  if (feito) return { text: fmtShort(q) };
  if (d < 0) return { text: `atrasado · ${fmtShort(q)}`, kind: "late" };
  if (d === 0) return { text: "prazo hoje", kind: "soon" };
  if (d === 1) return { text: "amanhã", kind: "soon" };
  if (d < 7) return { text: `${SEMANA[parseDay(q).getDay()]}, ${fmtShort(q)}` };
  return { text: fmtShort(q) };
}

/* ---------- consultas locais ---------- */
function findItem(key){
  const tab = key.split("|")[0];
  return (S.data[tab] || []).find(i => i.key === key) || null;
}
function copiesOf(p){ return [...(S.data.lembretes || []), ...(S.data.dia || [])].filter(c => c.pedido === p.id); }
function pedidoOf(c){ return c.pedido ? (S.data.terceiros || []).find(p => p.id === c.pedido) || null : null; }

function chipsSimple(i){
  const c = [];
  if (i.pedido) c.push({ text: "de terceiros", kind: "from" });
  const rc = recDe(i);
  if (i.recorrencia) c.push({ text: rc ? "repete: " + descRec(rc).split(" · ")[0].toLowerCase() : "recorrente" });
  else if (i.quando) c.push(dueChip(i.quando, i.feito));
  if (i.tab === "dia" && !i.feito && i.criadoEm && !i.quando){
    const iso = dayOf(i.criadoEm), diff = daysBetween(iso, S.today);
    if (diff === 1) c.push({ text: "desde ontem", kind: "soon" });
    else if (diff > 1) c.push({ text: `desde ${fmtShort(iso)}`, kind: "late" });
  }
  if (i.feito && i.feitoEm) c.push({ text: "feito " + when(i.feitoEm) });
  return c;
}
function chipsPedido(i){
  const c = [];
  if (i.criadoEm) c.push({ text: when(i.criadoEm) });
  if (i.tab === "terceiros" && !i.feito){ const cp = copiesOf(i)[0]; if (cp) c.push({ text: cp.tab === "dia" ? "na lista do dia" : "nos lembretes", kind: "from" }); }
  if (i.feito && i.feitoEm) c.push({ text: (i.tab === "enviados" ? "concluída " : "feito ") + when(i.feitoEm) });
  return c;
}
function canToggle(i){ return i.tab !== "enviados" && !(i.tab === "dia" && S.active === "dia" && S.diaDate < S.today); }
function canEditTitle(i){ return i.tab !== "terceiros"; }
function checkBtn(i, enabled){
  const box = el("button", "check");
  box.type = "button"; box.setAttribute("role", "checkbox");
  box.setAttribute("aria-checked", String(i.feito));
  box.setAttribute("aria-label", (i.feito ? "Marcar como pendente: " : "Marcar como feito: ") + (i.texto || "card"));
  box.innerHTML = ICON.check;
  if (enabled) box.addEventListener("click", () => toggleItem(i)); else box.disabled = true;
  return box;
}
function dropTargets(i){
  if (i.tab === "lembretes") return ["dia"];
  if (i.tab === "dia") return ["lembretes"];
  if (i.tab === "terceiros") return ["lembretes", "dia"];
  return [];
}
function cardEl(i){
  const past = i.tab === "dia" && S.diaDate < S.today;
  const draggable = !past && (i.tab === "lembretes" || i.tab === "dia" || (i.tab === "terceiros" && !i.feito && copiesOf(i).length === 0));
  const art = el("article", "card" + (i.feito ? " is-done" : "") + (!i.feito && i.prioridade === "alta" ? " prio-alta" : ""));
  art.dataset.key = i.key; art.dataset.tab = i.tab === "enviados" ? "terceiros" : i.tab;

  const open = el("button", "card-open");
  open.type = "button"; open.setAttribute("aria-label", "Abrir: " + (i.texto || "sem título"));
  open.addEventListener("click", () => { if (!S.suppressClick) openEditor(i.key); });

  const top = el("div", "card-top");
  top.append(checkBtn(i, canToggle(i)), el("h3", "card-title", i.texto || "Sem título"));
  if (draggable){
    const g = el("button", "grip");
    g.type = "button"; g.title = "Arraste para outra aba"; g.setAttribute("aria-label", "Mover para outra aba");
    g.innerHTML = ICON.grip;
    g.addEventListener("click", () => { if (!S.suppressClick) openEditor(i.key); });
    top.append(g);
  }
  const pt = plainText(i.notas).trim(), hasNotes = !!pt;
  art.append(open, top, el("p", "card-notes" + (hasNotes ? "" : " is-empty"), hasNotes ? pt : "Sem anotações. Clique para escrever."));

  const isP = isPedidoTab(i.tab);
  const chips = isP ? chipsPedido(i) : chipsSimple(i);
  const foot = el("div", "card-foot");
  if (!i.feito) foot.append(prioEl(i.prioridade));
  if (i.tab === "terceiros") foot.append(whoEl(i.de, "de"));
  if (i.tab === "enviados") foot.append(whoEl(i.para, "para"));
  chips.forEach(c => foot.append(chipEl(c)));
  const tf = tarefasDe(i.notas);
  if (tf) foot.append(chipEl({ text: `tarefas ${tf.feitas}/${tf.total}`, kind: tf.feitas === tf.total ? "from" : "" }));
  const na = (i.anexos || []).length;
  if (na) foot.append(chipEl({ text: `${na} ${na === 1 ? "anexo" : "anexos"}` }));
  if (foot.childNodes.length) art.append(foot);
  if (draggable) art.addEventListener("pointerdown", (e) => onPointerDown(e, art, i));
  return art;
}

function fillPanel(tab, pending, done, emptyText){
  $("#list-" + tab).replaceChildren(...pending);
  const empty = $("#empty-" + tab);
  empty.hidden = !emptyText; empty.textContent = emptyText || "";
  $("#done-" + tab).hidden = done.length === 0;
  $("#done-count-" + tab).textContent = done.length;
  $("#done-list-" + tab).replaceChildren(...done);
  const c = $("#count-" + tab); if (c) c.textContent = S.data[tab] === null ? "–" : pending.length;
}
function waitingPanel(tab){ fillPanel(tab, [], [], "Carregando…"); }

/* ---------- abas de cards ---------- */
function renderLembretes(){
  const data = S.data.lembretes;
  if (data === null) return waitingPanel("lembretes");
  const pend = data.filter(i => !i.feito).sort((a, b) => {
    const p = byPrio(a, b); if (p) return p;
    if (a.quando && b.quando) return a.quando.localeCompare(b.quando) || byCreated(a, b);
    if (a.quando) return -1; if (b.quando) return 1;
    return byCreated(a, b);
  });
  markAlta("lembretes", pend);
  const done = data.filter(i => i.feito && !i.arquivado).sort(byDoneDesc);
  fillPanel("lembretes", pend.map(cardEl), done.map(cardEl),
    pend.length ? "" : done.length ? "Tudo resolvido por aqui." : "Nenhum lembrete. Escreva um título acima para criar o primeiro card.");
}

function renderDiaNav(){
  const D = S.diaDate, diff = daysBetween(D, S.today);
  const rel = diff === 0 ? "Hoje" : diff === 1 ? "Ontem" : diff === -1 ? "Amanhã" : "";
  const ld = parseDay(D).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  $("#dia-label").textContent = rel ? `${rel} · ${ld}` : cap(ld);
  $("#dia-hoje").hidden = diff === 0;
  $("#in-dia").placeholder = D > S.today ? "Título do card para este dia" : "Título, ex.: Faturar nota do cliente X";
}
function setDiaDate(iso){ S.diaDate = iso; render("dia"); }
function shiftDia(n){ const d = parseDay(S.diaDate); d.setDate(d.getDate() + n); setDiaDate(localISO(d)); }
$("#dia-prev").addEventListener("click", () => shiftDia(-1));
$("#dia-next").addEventListener("click", () => shiftDia(1));
$("#dia-hoje").addEventListener("click", () => setDiaDate(S.today));

function closingOf(iso){
  const dia = S.data.dia || [];
  const feitas = dia.filter(i => i.feito && i.feitoEm && dayOf(i.feitoEm) === iso);
  const pendentes = dia.filter(i => {
    if (!i.criadoEm || dayOf(i.criadoEm) > iso) return false;
    if (i.quando && i.quando > iso) return false;
    if (vencidoRec(i, iso)) return false;
    if (!i.feito) return true;
    return !!i.feitoEm && dayOf(i.feitoEm) > iso;
  });
  return { feitas, pendentes };
}
function renderDia(){
  const data = S.data.dia;
  renderDiaNav();
  if (data === null){ $("#progress-dia").textContent = ""; $("#dia-note").hidden = true; return waitingPanel("dia"); }
  const D = S.diaDate, T = S.today;
  const sortP = (a, b) => byPrio(a, b) || byCreated(a, b);
  const todayPend = data.filter(i => !i.feito && (!i.quando || i.quando <= T) && !vencidoRec(i, T)).sort(sortP);
  markAlta("dia", todayPend);
  let pend, done, empty, noteText = "";
  if (D === T){
    pend = todayPend;
    // Feitas ficam no dia em que foram concluídas: hoje mostra só as concluídas hoje.
    done = data.filter(i => i.feito && !i.arquivado && i.feitoEm && dayOf(i.feitoEm) === T).sort(byDoneDesc);
    noteText = "";
    empty = pend.length ? "" : done.length ? "Tudo feito por hoje." : "Nada para hoje ainda. Escreva um título acima para criar o primeiro card. As feitas de dias anteriores ficam no dia em que foram concluídas (use a seta ←).";
    const fh = data.filter(i => i.feito && i.feitoEm && dayOf(i.feitoEm) === T).length;
    $("#progress-dia").textContent = (pend.length + fh) ? `${fh} de ${pend.length + fh} feitas hoje` : "";
  } else if (D < T){
    const c = closingOf(D);
    pend = c.pendentes.sort(sortP); done = c.feitas.sort(byDoneAsc);
    noteText = pend.length || done.length
      ? `Como este dia fechou: ${done.length} ${done.length === 1 ? "feita" : "feitas"} e ${pend.length} ${pend.length === 1 ? "ficou pendente" : "ficaram pendentes"}. Os cards abaixo são o que ficou pendente; as feitas estão logo depois.`
      : "";
    empty = pend.length ? "" : done.length ? "Nada ficou pendente neste dia." : "Nenhuma demanda registrada neste dia.";
    $("#progress-dia").textContent = (pend.length + done.length) ? `${done.length} de ${pend.length + done.length} feitas` : "";
  } else {
    // Dia futuro: o que está pendente hoje passa para este dia se não for concluído, mais o que foi agendado para ele.
    pend = data.filter(i => !i.feito && (!i.quando || i.quando <= D) && !i.recorrencia)
      .concat((S.data.lembretes || []).filter(i => !i.feito && i.quando && i.quando > T && i.quando <= D)).sort(sortP);
    done = [];
    const agendadas = pend.filter(i => i.quando === D).length, passam = pend.length - agendadas;
    noteText = `Previsão para este dia: ${passam} ${passam === 1 ? "demanda pendente passa" : "demandas pendentes passam"} para cá se não forem concluídas antes` +
      (agendadas ? `, mais ${agendadas} ${agendadas === 1 ? "agendada" : "agendadas"} para esta data.` : ".");
    const recsDia = S.recs.filter(r => ocorreEm(r, D));
    if (recsDia.length) noteText += ` Recorrentes que aparecem neste dia: ${listaPt(recsDia.map(r => r.texto))}.`;
    empty = pend.length ? "" : "Nada previsto. Crie um card acima para agendar para este dia.";
    $("#progress-dia").textContent = "";
  }
  fillPanel("dia", pend.map(cardEl), done.map(cardEl), empty);
  $("#count-dia").textContent = todayPend.length;
  const note = $("#dia-note"); note.hidden = !noteText; note.textContent = noteText;
  $("#form-dia").hidden = D < T; $("#tip-dia").hidden = D < T;
  $("#tools-dia").hidden = D !== T;
  $("#done-sum-dia").textContent = D < T ? "Feitas neste dia" : "Feitas";
  if (D < T && done.length) $("#done-dia").open = true;
  renderRecList();
}

function renderTerceiros(){
  const rec = S.data.terceiros;
  if (rec === null){ waitingPanel("terceiros"); waitingPanel("enviados"); return; }
  const sortP = (a, b) => byPrio(a, b) || byCreated(a, b);
  const pend = rec.filter(i => !i.feito).sort(sortP);
  markAlta("terceiros", pend);
  const done = rec.filter(i => i.feito && !i.arquivado).sort(byDoneDesc);
  fillPanel("terceiros", pend.map(cardEl), done.map(cardEl),
    pend.length ? "" : done.length ? "Nenhuma demanda pendente." : "Ninguém pediu nada por enquanto. Quando um colega mandar uma demanda para você, o card aparece aqui.");
  const env = S.data.enviados || [];
  const ePend = env.filter(i => !i.feito).sort(sortP);
  const eDone = env.filter(i => i.feito).sort(byDoneDesc);
  fillPanel("enviados", ePend.map(cardEl), eDone.map(cardEl),
    ePend.length ? "" : eDone.length ? "Tudo o que você pediu já foi concluído." : "Você ainda não pediu nada a ninguém.");
}

/* ---------- calendário ---------- */
function doneEntries(){
  const out = [], copied = new Set();
  for (const tab of ["lembretes", "dia"]) for (const i of S.data[tab] || []){
    if (i.pedido) copied.add(i.pedido);
    if (i.feito && i.feitoEm) out.push({ item: i, day: dayOf(i.feitoEm) });
  }
  for (const i of S.data.terceiros || []){
    if (i.feito && i.feitoEm && !copied.has(i.id)) out.push({ item: i, day: dayOf(i.feitoEm) });
  }
  return out;
}
function dueEntries(){
  const out = [];
  for (const tab of ["lembretes", "dia"]) for (const i of S.data[tab] || []) if (!i.feito && i.quando && !i.recorrencia) out.push({ item: i, day: i.quando });
  return out;
}
function groupBy(list){ const g = {}; for (const e of list) (g[e.day] = g[e.day] || []).push(e); return g; }
function renderCal(){
  const { y, m } = S.cal;
  $("#cal-month").textContent = cap(`${MESES_LONGOS[m]} de ${y}`);
  const doneBy = groupBy(doneEntries()), dueBy = groupBy(dueEntries());
  const cells = [];
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  for (let k = 0; k < first; k++) cells.push(el("span", "cal-day blank"));
  let monthDone = 0;
  for (let d = 1; d <= days; d++){
    const iso = `${y}-${pad(m+1)}-${pad(d)}`;
    const dn = doneBy[iso] || [], du = dueBy[iso] || [];
    monthDone += dn.length;
    const b = el("button", "cal-day");
    b.type = "button";
    if (iso === S.today) b.classList.add("is-today");
    if (iso > S.today) b.classList.add("is-future");
    b.setAttribute("aria-pressed", String(iso === S.cal.sel));
    b.append(el("span", null, String(d)));
    const dots = el("span", "cal-dots");
    dn.slice(0, 4).forEach(e => { const i = el("i"); i.dataset.tab = e.item.tab; dots.append(i); });
    if (dn.length > 4) dots.append(el("b", null, "+" + (dn.length - 4)));
    if (du.length) dots.append(el("i", "due"));
    b.append(dots);
    let label = `${d} de ${MESES_LONGOS[m]}: ${dn.length} ${dn.length === 1 ? "concluída" : "concluídas"}`;
    if (du.length) label += `, ${du.length} com prazo`;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => { S.cal.sel = iso; S.diaDate = iso; renderCal(); render("dia"); });
    cells.push(b);
  }
  $("#cal-grid").replaceChildren(...cells);
  $("#cal-summary").textContent = monthDone ? `${monthDone} ${monthDone === 1 ? "concluída" : "concluídas"} em ${MESES_LONGOS[m]}` : "";

  const sel = S.cal.sel;
  $("#day-title").textContent = longDay(sel);
  const diff = daysBetween(sel, S.today);
  $("#day-sub").textContent = diff === 0 ? "hoje" : diff === 1 ? "ontem" : diff === -1 ? "amanhã" : diff > 0 ? `há ${diff} dias` : `daqui a ${-diff} dias`;
  const dn = (doneBy[sel] || []).sort((a, b) => byDoneAsc(a.item, b.item));
  const du = dueBy[sel] || [];

  let fe = [], left = [];
  if (diff >= 0 && S.data.dia !== null) ({ feitas: fe, pendentes: left } = closingOf(sel));
  const hasClose = !!(fe.length || left.length);
  $("#close-wrap").hidden = !hasClose;
  if (hasClose){
    const tot = fe.length + left.length;
    $("#close-title").textContent = diff === 0 ? "Demandas do dia, até agora" : "Como fechou o dia nas Demandas do dia";
    $("#close-fill").style.width = Math.round(fe.length / tot * 100) + "%";
    const resto = diff === 0 ? (left.length === 1 ? "pendente" : "pendentes") : (left.length === 1 ? "ficou pendente" : "ficaram pendentes");
    $("#close-sum").textContent = `${fe.length} ${fe.length === 1 ? "feita" : "feitas"} · ${left.length} ${resto}`;
    $("#close-done-wrap").hidden = !fe.length;
    $("#close-left-wrap").hidden = !left.length;
    $("#close-left-title").textContent = diff === 0 ? "Ainda pendentes" : "Ficaram pendentes";
    $("#close-done").replaceChildren(...fe.sort(byDoneAsc).map(i => miniRow(i, hm(i.feitoEm), true)));
    $("#close-left").replaceChildren(...left.sort((a, b) => byPrio(a, b) || byCreated(a, b))
      .map(i => miniRow(i, i.feito ? "feita " + fmtShort(dayOf(i.feitoEm)) : "pendente", true)));
  }
  const other = dn.filter(e => e.item.tab !== "dia");
  $("#day-done-wrap").hidden = !other.length;
  $("#day-done").replaceChildren(...other.map(e => miniRow(e.item, hm(e.item.feitoEm))));
  $("#day-due-wrap").hidden = !du.length;
  $("#day-due").replaceChildren(...du.sort((a, b) => byPrio(a.item, b.item)).map(e => miniRow(e.item, e.item.tab === "lembretes" ? "lembrete" : "do dia", true)));
  const empty = $("#day-empty");
  empty.hidden = !!(hasClose || other.length || du.length);
  empty.textContent = S.data.dia === null ? "Carregando…"
    : diff > 0 ? "Nada registrado neste dia." : diff === 0 ? "Nada feito hoje ainda. As Demandas do dia e os cards concluídos aparecem aqui." : "Nenhum prazo para este dia.";
}
function miniRow(i, side, withPrio){
  const b = el("button", "mini");
  b.type = "button"; b.dataset.tab = i.tab;
  const mid = el("span");
  mid.append(el("span", "mini-title", i.texto || "Sem título"));
  let sub = plainText(i.notas).trim() ? plainText(i.notas).trim().split("\n")[0] : NOMES[i.tab];
  if (withPrio) sub = `Prioridade ${PRIO_NOME[i.prioridade].toLowerCase()} · ${sub}`;
  mid.append(el("span", "mini-notes", sub));
  b.append(el("span", "mini-mark"), mid, el("span", "mini-time", side));
  b.addEventListener("click", () => openEditor(i.key));
  return b;
}
function shiftMonth(n){
  let { y, m } = S.cal; m += n;
  if (m < 0){ m = 11; y--; } if (m > 11){ m = 0; y++; }
  S.cal.y = y; S.cal.m = m;
  S.cal.sel = S.today.startsWith(`${y}-${pad(m+1)}`) ? S.today : `${y}-${pad(m+1)}-01`;
  renderCal();
}
$("#day-open-dia").addEventListener("click", () => { S.diaDate = S.cal.sel; render("dia"); activate("dia", false); window.scrollTo({ top: 0 }); });
$("#cal-prev").addEventListener("click", () => shiftMonth(-1));
$("#cal-next").addEventListener("click", () => shiftMonth(1));
$("#cal-today").addEventListener("click", () => { const d = new Date(); S.cal = { y: d.getFullYear(), m: d.getMonth(), sel: S.today }; renderCal(); });

/* ---------- rotina ---------- */
function rotinaItens(){
  const T = S.today, out = [];
  const limite = (() => { const d = parseDay(T); d.setDate(d.getDate() + 2); return localISO(d); })();
  const copiados = new Set([...(S.data.lembretes || []), ...(S.data.dia || [])].filter(c => c.pedido).map(c => c.pedido));
  const add = (i, origem) => {
    let score = { alta: 400, media: 200, baixa: 0 }[i.prioridade];
    const motivos = [];
    if (i.quando && !i.recorrencia){
      const d = daysBetween(T, i.quando);
      if (d < 0){ score += 200 + 10 * Math.min(-d, 30); motivos.push({ text: `atrasado ${-d} ${-d === 1 ? "dia" : "dias"}`, kind: "late" }); }
      else if (d === 0){ score += 150; motivos.push({ text: "vence hoje", kind: "soon" }); }
      else if (d === 1){ score += 60; motivos.push({ text: "vence amanhã", kind: "soon" }); }
      else { score += 20; motivos.push({ text: "vence " + fmtShort(i.quando) }); }
    }
    if (origem === "dia"){
      score += 50;
      if (i.criadoEm && !i.quando){
        const dd = daysBetween(dayOf(i.criadoEm), T);
        if (dd > 0){ score += Math.min(25 * dd, 150); motivos.push({ text: `pendente há ${dd} ${dd === 1 ? "dia" : "dias"}`, kind: dd > 1 ? "late" : "soon" }); }
      }
    }
    if (origem === "lembretes" && !i.quando) score -= 60;
    const p = origem === "terceiros" ? i : pedidoOf(i);
    if (p){ score += 40; motivos.push({ text: "pedido de " + nomeDe(p.de), kind: "from" }); }
    out.push({ item: i, score, motivos });
  };
  for (const i of S.data.dia || []) if (!i.feito && (!i.quando || i.quando <= T) && !vencidoRec(i, T)) add(i, "dia");
  for (const i of S.data.lembretes || []) if (!i.feito && (!i.quando || i.quando <= limite)) add(i, "lembretes");
  for (const i of S.data.terceiros || []) if (!i.feito && !copiados.has(i.id)) add(i, "terceiros");
  return out.sort((a, b) => b.score - a.score || byCreated(a.item, b.item));
}
function renderRotina(){
  const wrap = $("#rot-groups"), empty = $("#empty-rotina");
  if (S.data.dia === null || S.data.lembretes === null || S.data.terceiros === null){
    wrap.replaceChildren(); empty.hidden = false; empty.textContent = "Carregando…"; $("#count-rotina").textContent = "–"; return;
  }
  const itens = rotinaItens();
  $("#count-rotina").textContent = itens.length;
  markAlta("rotina", itens.map(x => x.item));
  const feitasHoje = [...S.data.dia, ...S.data.lembretes, ...S.data.terceiros].filter(i => i.feito && i.feitoEm && dayOf(i.feitoEm) === S.today).length;
  $("#rot-summary").textContent = feitasHoje ? `${feitasHoje} ${feitasHoje === 1 ? "feita" : "feitas"} hoje` : "";
  empty.hidden = itens.length > 0;
  empty.textContent = "Nada pendente agora. Quando você criar demandas ou um colega pedir algo, a rotina se monta aqui.";
  const grupos = [["Comece por aqui", itens.slice(0, 3)], ["Em seguida", itens.slice(3, 8)], ["Se sobrar tempo", itens.slice(8)]];
  let n = 0;
  wrap.replaceChildren(...grupos.filter(g => g[1].length).map(([titulo, lista]) => {
    const g = el("div", "rot-group");
    g.append(el("h3", "rot-title", titulo));
    const ol = el("ol", "rot-list"); ol.start = n + 1;
    for (const x of lista){ n++; ol.append(rotItem(x, n)); }
    g.append(ol);
    return g;
  }));
}
function rotItem(x, n){
  const i = x.item;
  const li = el("li", "rot-item" + (i.prioridade === "alta" ? " is-alta" : ""));
  li.dataset.tab = i.tab;
  const body = el("button", "rot-body"); body.type = "button";
  body.append(el("span", "rot-text", i.texto || "Sem título"));
  const meta = el("span", "rot-meta");
  const src = el("span", "rot-src"); src.append(el("span", "tab-mark"), el("span", null, NOMES[i.tab]));
  meta.append(prioEl(i.prioridade), src);
  x.motivos.forEach(m => meta.append(chipEl(m)));
  body.append(meta);
  if (plainText(i.notas).trim()) body.append(el("span", "rot-notes", plainText(i.notas).trim().split("\n")[0]));
  body.addEventListener("click", () => openEditor(i.key));
  li.append(el("span", "rot-num", String(n)), checkBtn(i, true), body);
  return li;
}

function render(tab){
  if (S.hold){ S.dirty.add(tab); return; }
  if (tab === "lembretes") renderLembretes();
  else if (tab === "dia") renderDia();
  else if (tab === "terceiros") renderTerceiros();
  else if (tab === "rotina") renderRotina();
  else renderCal();
}
function renderAll(){ TABS.forEach(render); }
function flushDirty(){ const d = [...S.dirty]; S.dirty.clear(); d.forEach(render); }

/* ---------- ações ---------- */
async function toggleItem(i){
  if (!canToggle(i)) return;
  const feito = !i.feito, ts = new Date().toISOString();
  const patch = feito ? { feito, feitoEm: ts } : { feito, feitoEm: null, arquivado: false };
  const ok = await write(() => patchItem(i, patch));
  if (!ok) return;
  if (i.pedido){
    const p = pedidoOf(i);
    if (p && p.feito !== feito) write(() => patchItem(p, patch));
  }
  if (i.tab === "terceiros"){
    for (const c of copiesOf(i)) if (c.feito !== feito) write(() => patchItem(c, patch));
  }
}
const fileDeletes = new Map();
function scheduleFileDelete(key, paths){
  if (!paths.length) return;
  clearTimeout(fileDeletes.get(key));
  fileDeletes.set(key, setTimeout(() => { fileDeletes.delete(key); sb.storage.from(BUCKET).remove(paths).catch(() => {}); }, 8000));
}
function cancelFileDelete(key){ clearTimeout(fileDeletes.get(key)); fileDeletes.delete(key); }
const ownFiles = (i, pasta) => (i.anexos || []).map(a => a.path).filter(p => p.startsWith(`${pasta}/${i.id}/`));
async function removeSimple(i){
  const row = cardRow(i);
  if (await write(() => q(sb.from("cards").delete().eq("id", i.id)))){
    scheduleFileDelete(i.key, ownFiles(i, "cards"));
    toast("Card excluído.", { label: "Desfazer", run: () => { cancelFileDelete(i.key); write(() => q(sb.from("cards").insert(row))); } });
  }
}
async function removeRecebido(i){
  if (await write(() => patchItem(i, { removido: true }))){
    toast("Removido da sua lista.", { label: "Desfazer", run: () => write(() => patchItem(i, { removido: false })) });
  }
}
async function removeEnviado(i){
  const row = { id: i.id, para: i.para, texto: i.texto, notas: i.notas, prioridade: i.prioridade, criado_em: i.criadoEm, anexos: i.anexos || [] };
  if (await write(() => q(sb.from("pedidos").delete().eq("id", i.id)))){
    scheduleFileDelete(i.key, ownFiles(i, "pedidos"));
    toast("Pedido excluído.", { label: "Desfazer", run: () => { cancelFileDelete(i.key); write(() => q(sb.from("pedidos").insert(row))); } });
  }
}
async function moveSimple(i, dest){
  const src = i.tab;
  const move = (to) => write(() => patchItem(i, { aba: to }));
  if (await move(dest)) toast(`Movido para ${NOMES[dest]}.`, { label: "Desfazer", run: () => move(src) });
}
async function copyPedido(p, dest){
  const ok = await write(() => q(sb.from("cards").insert({ aba: dest, texto: p.texto, notas: p.notas || "", prioridade: p.prioridade, pedido: p.id, anexos: p.anexos || [] })));
  if (ok) toast(`Levado para ${NOMES[dest]}.`, { label: "Ver", run: () => activate(dest, false) });
}
function dropOn(i, dest){ if (i.tab === "terceiros") copyPedido(i, dest); else moveSimple(i, dest); }
async function archiveDone(tab){
  const list = (S.data[tab] || []).filter(i => i.feito && !i.arquivado);
  if (!list.length) return;
  const ids = list.map(i => i.id);
  const table = tab === "terceiros" ? "pedidos" : "cards";
  const col = tab === "terceiros" ? "arquivado_para" : "arquivado";
  const apply = (flag) => write(() => q(sb.from(table).update({ [col]: flag }).in("id", ids)));
  if (await apply(true)) toast(`${list.length} ${list.length === 1 ? "card arquivado" : "cards arquivados"}. Continuam no calendário.`, { label: "Desfazer", run: () => apply(false) });
}
document.querySelectorAll("[data-archive]").forEach(b => b.addEventListener("click", () => archiveDone(b.dataset.archive)));

/* ---------- arrastar e soltar ---------- */
function onPointerDown(e, art, i){
  if (e.button !== 0 || S.drag || S.ed) return;
  if (e.target.closest(".check")) return;
  const onGrip = !!e.target.closest(".grip");
  if (e.pointerType !== "mouse" && !onGrip) return;
  S.drag = { i, art, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, ghost: null, over: null, targets: dropTargets(i) };
  window.addEventListener("pointermove", onWinMove, { passive: false });
  window.addEventListener("pointerup", onWinUp);
  window.addEventListener("pointercancel", onWinCancel);
}
function onWinMove(e){
  const d = S.drag; if (!d || e.pointerId !== d.id) return;
  if (!d.active){
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    startDrag(e);
  }
  e.preventDefault();
  moveDrag(e);
}
function onWinUp(e){ if (S.drag && e.pointerId === S.drag.id) endDrag(true); }
function onWinCancel(e){ if (S.drag && e.pointerId === S.drag.id) endDrag(false); }
function startDrag(e){
  const d = S.drag; d.active = true; S.hold = true;
  const r = d.art.getBoundingClientRect();
  d.offX = e.clientX - r.left; d.offY = e.clientY - r.top;
  const g = d.art.cloneNode(true);
  g.classList.add("ghost"); g.removeAttribute("data-key"); g.setAttribute("aria-hidden", "true");
  g.style.width = r.width + "px";
  document.body.append(g); d.ghost = g;
  d.art.classList.add("is-lifted"); html.classList.add("is-dragging");
  for (const t of d.targets) $("#tab-" + t).classList.add("drop-ok");
  const hint = $("#drop-hint");
  hint.textContent = d.i.tab === "terceiros" ? "Solte sobre Lembretes ou Demandas do dia" : `Solte sobre a aba ${NOMES[d.targets[0]]} para mover`;
  hint.hidden = false;
}
function moveDrag(e){
  const d = S.drag;
  d.ghost.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px) rotate(1.5deg)`;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const tabEl = hit && hit.closest(".tab.drop-ok");
  const over = tabEl ? tabEl.dataset.tab : null;
  if (over !== d.over){
    if (d.over) $("#tab-" + d.over).classList.remove("drop-hover");
    if (tabEl) tabEl.classList.add("drop-hover");
    d.over = over;
  }
}
function endDrag(commit){
  const d = S.drag; if (!d) return;
  S.drag = null;
  window.removeEventListener("pointermove", onWinMove, { passive: false });
  window.removeEventListener("pointerup", onWinUp);
  window.removeEventListener("pointercancel", onWinCancel);
  if (!d.active) return;
  d.ghost.remove(); d.art.classList.remove("is-lifted"); html.classList.remove("is-dragging");
  document.querySelectorAll(".tab.drop-ok,.tab.drop-hover").forEach(t => t.classList.remove("drop-ok", "drop-hover"));
  $("#drop-hint").hidden = true;
  S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 80);
  S.hold = false; flushDirty();
  if (commit && d.over) dropOn(d.i, d.over);
}

/* ---------- editor do card ---------- */
const ED = { modal: $("#modal"), title: $("#ed-title"), notes: $("#ed-notes"), date: $("#ed-date"), check: $("#ed-check") };
function autosize(t){ t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
function setEdSaved(text){ $("#ed-saved").textContent = text; }
function openEditor(key){
  const i = findItem(key); if (!i) return;
  S.ed = { key, item: i, dirty: false, timer: null, chain: null, last: null, ret: document.activeElement };
  ED.modal.dataset.tab = i.tab === "enviados" ? "terceiros" : i.tab;
  $("#ed-where-text").textContent = NOMES[i.tab];
  ED.title.value = i.texto; ED.notes.innerHTML = toHtml(i.notas); notesEmptyState();
  ED.title.readOnly = !canEditTitle(i);
  ED.notes.dataset.placeholder = "Anote aqui tudo sobre esta demanda: contatos, valores, prazos, próximos passos…";
  const hint = $("#ed-hint");
  hint.hidden = !isPedidoTab(i.tab);
  hint.textContent = i.tab === "terceiros" ? `${nomeDe(i.de)} também vê estas anotações. Só quem pediu muda o título.`
    : i.tab === "enviados" ? `${nomeDe(i.para)} também vê e pode anotar aqui.` : "";
  $("#ed-date-wrap").hidden = isPedidoTab(i.tab);
  const del = $("#ed-delete");
  del.textContent = i.tab === "terceiros" ? "Remover da minha lista" : i.tab === "enviados" ? "Excluir pedido" : "Excluir card";
  setEdSaved("");
  refreshEditorMeta();
  $("#ed-anexos").replaceChildren(); renderAnexos();
  ED.modal.hidden = false; html.classList.add("modal-open");
  autosize(ED.title);
  if (window.matchMedia("(hover: hover)").matches){
    ED.notes.focus(); caretAoFim(ED.notes);
  } else $("#editor").focus();
}
function refreshEditorMeta(){
  const ed = S.ed; if (!ed) return;
  const i = ed.item;
  ED.check.setAttribute("aria-checked", String(i.feito));
  ED.check.disabled = !canToggle(i);
  $("#ed-check-label").textContent = i.feito ? (i.feitoEm ? "Feito " + when(i.feitoEm) : "Feito") : "Pendente";
  if (!isPedidoTab(i.tab) && document.activeElement !== ED.date) ED.date.value = i.quando || "";
  $("#ed-prio-" + i.prioridade).checked = true;
  const a = $("#ed-author"); a.replaceChildren();
  if (i.tab === "terceiros"){ a.append(whoEl(i.de, "pedido por")); if (i.criadoEm) a.append(chipEl({ text: when(i.criadoEm) })); }
  else if (i.tab === "enviados"){ a.append(whoEl(i.para, "para")); if (i.criadoEm) a.append(chipEl({ text: "enviado " + when(i.criadoEm) })); }
  else if (i.pedido) a.append(chipEl({ text: "veio de Demandas de terceiros", kind: "from" }));
  const mv = $("#ed-move"); mv.replaceChildren();
  if (i.tab === "terceiros"){
    const cp = copiesOf(i);
    if (cp.length) mv.append(el("span", "ed-move-label", `Já está em ${NOMES[cp[0].tab]}`));
    else if (!i.feito){
      mv.append(el("span", "ed-move-label", "Levar para"));
      for (const t of ["lembretes", "dia"]) mv.append(moveBtn(t, async () => { const it = await closeEditor(); if (it) copyPedido(it, t); }));
    }
  } else if (i.tab === "lembretes" || i.tab === "dia"){
    mv.append(el("span", "ed-move-label", "Mover para"));
    for (const t of dropTargets(i)) mv.append(moveBtn(t, async () => { const it = await closeEditor(); if (it) moveSimple(it, t); }));
    const rc = recDe(i);
    if (rc && recAtiva(rc)){
      a.append(chipEl({ text: "repete: " + descRec(rc).toLowerCase() }));
      const b = el("button", "link-btn danger-btn", "Parar de repetir"); b.type = "button";
      b.addEventListener("click", () => pararRecorrencia(rc));
      mv.append(b);
    }
  }
}
function moveBtn(tab, run){
  const b = el("button", "move-btn"); b.type = "button"; b.dataset.tab = tab;
  b.append(el("span", "tab-mark"), el("span", null, NOMES[tab]));
  b.addEventListener("click", run);
  return b;
}
function readPatch(item){
  const patch = {};
  const notas = serializeNotes();
  if (notas.length <= 20000) patch.notas = notas;
  else toast("A anotação ficou longa demais para salvar. Divida em outro card ou use um anexo.");
  if (canEditTitle(item)){ const t = ED.title.value.replace(/\s+/g, " ").trim().slice(0, 280); if (t) patch.texto = t; }
  return patch;
}
function saveEditor(ed){
  clearTimeout(ed.timer);
  if (!ed.dirty) return ed.chain || Promise.resolve();
  ed.dirty = false;
  const patch = readPatch(ed.item);
  ed.last = Object.assign(ed.last || {}, patch);
  if (S.ed === ed) setEdSaved("Salvando…");
  ed.chain = (ed.chain || Promise.resolve())
    .then(() => write(() => patchItem(ed.item, patch)))
    .then(ok => { if (S.ed === ed) setEdSaved(ok ? "Salvo" : "Não foi salvo"); if (!ok) ed.dirty = true; });
  return ed.chain;
}
function markDirty(){
  const ed = S.ed; if (!ed) return;
  ed.dirty = true; setEdSaved("Editando…");
  clearTimeout(ed.timer); ed.timer = setTimeout(() => saveEditor(ed), 800);
}
async function closeEditor(opts = {}){
  const ed = S.ed; if (!ed) return null;
  if (!opts.discard) await saveEditor(ed); else clearTimeout(ed.timer);
  S.ed = null;
  ED.modal.hidden = true; html.classList.remove("modal-open");
  const back = document.querySelector(`.card[data-key="${CSS.escape(ed.key)}"] .card-open`) || (ed.ret && document.contains(ed.ret) ? ed.ret : null);
  if (back) back.focus({ preventScroll: true });
  return Object.assign({}, ed.item, ed.last || {});
}
function syncEditor(){
  const ed = S.ed; if (!ed) return;
  const ni = findItem(ed.key);
  if (!ni){ closeEditor({ discard: true }); toast("Este card foi removido ou movido."); return; }
  const mudou = JSON.stringify(ed.item.anexos || []) !== JSON.stringify(ni.anexos || []);
  ed.item = ni; refreshEditorMeta();
  if (mudou) renderAnexos();
}
ED.title.addEventListener("input", () => { autosize(ED.title); markDirty(); });
ED.title.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); ED.notes.focus(); } });
ED.notes.addEventListener("input", () => { notesEmptyState(); markDirty(); });

/* ---------- texto formatado das anotações ---------- */
const OK_TAGS = new Set(["B","STRONG","I","EM","U","S","STRIKE","DEL","UL","OL","LI","BR","P","DIV","H3","A","MARK","BLOCKQUOTE","CODE"]);
const DROP_TAGS = new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","TEMPLATE","SVG","MATH","IMG","VIDEO","AUDIO","CANVAS","LINK","META","TITLE","HEAD","NOSCRIPT","FORM","INPUT","BUTTON","SELECT","TEXTAREA"]);
const looksHtml = (t) => /<\/?(b|strong|i|em|u|s|strike|del|ul|ol|li|br|p|div|h3|a|mark|blockquote|code)\b/i.test(t || "");
function esc(t){ return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function sanitize(html){
  const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
  const root = doc.body.firstElementChild;
  const walk = (node) => {
    for (let ch of [...node.childNodes]){
      if (ch.nodeType === 3) continue;
      if (ch.nodeType !== 1 || DROP_TAGS.has(ch.tagName)){ ch.remove(); continue; }
      if (/^H[1-6]$/.test(ch.tagName) && ch.tagName !== "H3"){ const h = doc.createElement("h3"); h.append(...ch.childNodes); ch.replaceWith(h); ch = h; }
      walk(ch);
      const tag = ch.tagName;
      if (!OK_TAGS.has(tag)){ ch.replaceWith(...ch.childNodes); continue; }
      const href = tag === "A" ? (ch.getAttribute("href") || "") : "";
      const tarefas = tag === "UL" && ch.classList.contains("tarefas");
      const done = tag === "LI" && ch.getAttribute("data-done") === "1";
      for (const a of [...ch.attributes]) ch.removeAttribute(a.name);
      if (tag === "A"){
        if (/^(https?:|mailto:)/i.test(href)){ ch.setAttribute("href", href); ch.setAttribute("target", "_blank"); ch.setAttribute("rel", "noopener"); }
        else { ch.replaceWith(...ch.childNodes); continue; }
      }
      if (tarefas) ch.setAttribute("class", "tarefas");
      if (done) ch.setAttribute("data-done", "1");
    }
  };
  walk(root);
  return root.innerHTML;
}
function toHtml(notas){ return looksHtml(notas) ? sanitize(notas) : esc(notas || "").replace(/\n/g, "<br>"); }
const plainCache = new Map();
function plainText(notas){
  if (!notas || !looksHtml(notas)) return notas || "";
  if (plainCache.has(notas)) return plainCache.get(notas);
  const doc = new DOMParser().parseFromString("<div>" + sanitize(notas) + "</div>", "text/html");
  const out = [];
  const walk = (node, ctx) => {
    for (const ch of node.childNodes){
      if (ch.nodeType === 3){ out.push(ch.textContent); continue; }
      if (ch.nodeType !== 1) continue;
      const t = ch.tagName;
      if (t === "BR"){ out.push("\n"); continue; }
      if (t === "UL" || t === "OL"){ let n = 0; for (const li of ch.children){ if (li.tagName !== "LI") continue; n++;
          const pre = ch.classList.contains("tarefas") ? (li.getAttribute("data-done") === "1" ? "☑ " : "☐ ") : t === "OL" ? n + ". " : "• ";
          out.push("\n" + pre); walk(li); } out.push("\n"); continue; }
      const block = ["DIV","P","H3","BLOCKQUOTE","LI"].includes(t);
      if (block) out.push("\n");
      walk(ch);
      if (block) out.push("\n");
    }
  };
  walk(doc.body.firstElementChild);
  const txt = out.join("").replace(/\n{2,}/g, "\n").trim();
  if (plainCache.size > 500) plainCache.clear();
  plainCache.set(notas, txt);
  return txt;
}
function tarefasDe(notas){
  if (!notas || notas.indexOf("tarefas") < 0) return null;
  const doc = new DOMParser().parseFromString("<div>" + sanitize(notas) + "</div>", "text/html");
  const lis = doc.querySelectorAll("ul.tarefas > li");
  if (!lis.length) return null;
  return { total: lis.length, feitas: [...lis].filter(li => li.getAttribute("data-done") === "1").length };
}
function serializeNotes(){
  const html = sanitize(ED.notes.innerHTML).replace(/^(<br>|<div><br><\/div>|\s)+|(<br>|<div><br><\/div>|\s)+$/g, "");
  if (!ED.notes.textContent.trim() && !ED.notes.querySelector("li")) return "";
  return html;
}
function notesEmptyState(){ ED.notes.classList.toggle("is-empty", !ED.notes.textContent.trim() && !ED.notes.querySelector("li,h3")); }
function caretAoFim(node){
  try { const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch {}
}
try { document.execCommand("styleWithCSS", false, false); document.execCommand("defaultParagraphSeparator", false, "div"); } catch {}
function selNode(){ const s = getSelection(); if (!s.rangeCount) return null; const n = s.anchorNode; return n && (n.nodeType === 1 ? n : n.parentElement); }
function dentro(sel){ const n = selNode(); if (!n || !ED.notes.contains(n)) return null; const x = n.closest(sel); return x && ED.notes.contains(x) ? x : null; }
function unwrap(elm){ elm.replaceWith(...elm.childNodes); }
function aplicar(cmd){
  ED.notes.focus();
  if (cmd === "h3"){ document.execCommand("formatBlock", false, dentro("h3") ? "<div>" : "<h3>"); }
  else if (cmd === "mark"){
    const m = dentro("mark");
    if (m) unwrap(m);
    else { const t = getSelection().toString(); if (t) document.execCommand("insertHTML", false, "<mark>" + esc(t).replace(/\n/g, "<br>") + "</mark>"); }
  }
  else if (cmd === "link"){
    const a = dentro("a");
    if (a){ unwrap(a); }
    else {
      const sel = getSelection(), texto = sel.toString(), range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      let url = window.prompt("Endereço do link (ex.: www.site.com.br):", "");
      if (!url) return;
      url = url.trim(); if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
      ED.notes.focus(); if (range){ sel.removeAllRanges(); sel.addRange(range); }
      if (texto) document.execCommand("createLink", false, url);
      else document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(url)}</a>&nbsp;`);
    }
  }
  else if (cmd === "tarefas"){
    const ul = dentro("ul");
    if (ul && ul.classList.contains("tarefas")) document.execCommand("insertUnorderedList");
    else if (ul) ul.classList.add("tarefas");
    else { if (dentro("ol")) document.execCommand("insertOrderedList"); document.execCommand("insertUnorderedList"); const nu = dentro("ul"); if (nu) nu.classList.add("tarefas"); }
  }
  else if (cmd === "insertUnorderedList"){
    const ul = dentro("ul");
    if (ul && ul.classList.contains("tarefas")) ul.classList.remove("tarefas");
    else document.execCommand(cmd);
  }
  else if (cmd === "removeFormat"){
    document.execCommand("removeFormat");
    const m = dentro("mark"); if (m) unwrap(m);
    if (dentro("h3")) document.execCommand("formatBlock", false, "<div>");
  }
  else document.execCommand(cmd);
  notesEmptyState(); markDirty(); atualizarBarra();
}
function atualizarBarra(){
  const tar = !!(dentro("ul") && dentro("ul").classList.contains("tarefas"));
  const estado = {
    bold: !!dentro("b,strong"), italic: !!dentro("i,em"), underline: !!dentro("u"), strikeThrough: !!dentro("s,strike,del"),
    mark: !!dentro("mark"), h3: !!dentro("h3"), link: !!dentro("a"),
    insertOrderedList: !!dentro("ol"), insertUnorderedList: !!dentro("ul") && !tar, tarefas: tar
  };
  document.querySelectorAll("#fmt-bar [data-cmd]").forEach(b => { if (b.dataset.cmd in estado) b.setAttribute("aria-pressed", String(!!estado[b.dataset.cmd])); });
}
document.querySelectorAll("#fmt-bar [data-cmd]").forEach(b => {
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => aplicar(b.dataset.cmd));
});
document.addEventListener("selectionchange", () => { if (S.ed) atualizarBarra(); });
ED.notes.addEventListener("click", (e) => {
  const li = e.target.closest && e.target.closest("ul.tarefas > li");
  if (li && ED.notes.contains(li) && e.clientX < li.getBoundingClientRect().left + 2){
    e.preventDefault();
    if (li.getAttribute("data-done") === "1") li.removeAttribute("data-done"); else li.setAttribute("data-done", "1");
    markDirty(); return;
  }
  const a = e.target.closest && e.target.closest("a");
  if (a && (e.ctrlKey || e.metaKey)){ e.preventDefault(); window.open(a.href, "_blank", "noopener"); }
});
ED.notes.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && dentro("li")){ e.preventDefault(); document.execCommand(e.shiftKey ? "outdent" : "indent"); markDirty(); return; }
  if (e.key === "Enter" && !e.shiftKey){
    setTimeout(() => { const li = dentro("li"); if (li && !li.textContent.trim()) li.removeAttribute("data-done"); }, 0);
  }
  if (e.key === " " && !dentro("li")){
    const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const block = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest("div,p,h3") ;
    const base = block && ED.notes.contains(block) && block !== ED.notes ? block : ED.notes;
    const pre = document.createRange(); pre.setStart(base, 0); pre.setEnd(r.startContainer, r.startOffset);
    const t = pre.toString();
    const cmd = (t === "-" || t === "*") ? "insertUnorderedList" : /^1[.)]$/.test(t) ? "insertOrderedList" : (t === "[]" || t === "[ ]") ? "tarefas" : null;
    if (!cmd) return;
    e.preventDefault();
    sel.removeAllRanges(); sel.addRange(pre); document.execCommand("delete");
    aplicar(cmd);
  }
});
ED.notes.addEventListener("paste", (e) => {
  const cd = e.clipboardData; if (!cd) return;
  if (cd.files && cd.files.length) return;
  e.preventDefault();
  const html = cd.getData("text/html");
  const limpo = html ? sanitize(html.replace(/<!--[\s\S]*?-->/g, "")) : esc(cd.getData("text/plain")).replace(/\r?\n/g, "<br>");
  document.execCommand("insertHTML", false, limpo);
});
ED.date.addEventListener("change", () => {
  const ed = S.ed; if (!ed) return;
  write(() => patchItem(ed.item, { quando: isDay(ED.date.value) ? ED.date.value : null }));
});
ED.check.addEventListener("click", () => { if (S.ed) toggleItem(S.ed.item); });
document.querySelectorAll("#ed-prio input").forEach(r => r.addEventListener("change", () => {
  const ed = S.ed; if (!ed || !r.checked || ed.item.prioridade === r.value) return;
  write(() => patchItem(ed.item, { prioridade: r.value }));
}));
/* ---------- anexos ---------- */
const BUCKET = "anexos", MAX_MB = 10;
const urlCache = new Map();
async function signedUrls(paths){
  const now = Date.now(), need = paths.filter(p => !(urlCache.get(p) && urlCache.get(p).exp > now));
  if (need.length){
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
      if (!error && data) data.forEach(d => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 50 * 60000 }); });
    } catch (e){ console.warn(e); }
  }
  return Object.fromEntries(paths.map(p => [p, urlCache.get(p) ? urlCache.get(p).url : null]));
}
function seguro(n){ return (n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80)) || "arquivo"; }
function extOf(n){ const m = /\.([A-Za-z0-9]{1,5})$/.exec(n || ""); return m ? m[1].toUpperCase() : "ARQ"; }
function fmtSize(b){ if (typeof b !== "number") return ""; return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1).replace(".", ",") + " MB"; }
let anexoSeq = 0;
async function renderAnexos(){
  const ed = S.ed; if (!ed) return;
  const lista = ed.item.anexos || [], box = $("#ed-anexos"), seq = ++anexoSeq;
  $("#ed-anexos-count").textContent = lista.length ? `(${lista.length})` : "";
  if (!lista.length){ box.replaceChildren(); return; }
  const urls = await signedUrls(lista.map(a => a.path));
  if (seq !== anexoSeq || S.ed !== ed) return;
  box.replaceChildren(...lista.map(a => anexoEl(a, urls[a.path])));
}
function anexoEl(a, url){
  const isImg = /^image\//.test(a.tipo || "");
  const item = el("div", "anexo" + (isImg ? " is-img" : ""));
  const link = el("a", "anexo-link"); link.target = "_blank"; link.rel = "noopener";
  link.title = isImg ? "Abrir imagem" : "Baixar " + (a.nome || "arquivo");
  if (url) link.href = isImg ? url : url + (url.includes("?") ? "&" : "?") + "download=" + encodeURIComponent(a.nome || "arquivo");
  if (isImg){
    if (url){ const img = document.createElement("img"); img.src = url; img.alt = a.nome || "imagem"; img.loading = "lazy"; link.append(img); }
    else link.append(el("span", "anexo-ico", "IMG"));
  } else link.append(el("span", "anexo-ico", extOf(a.nome)), el("span", "anexo-nome", a.nome || "arquivo"), el("span", "anexo-size", fmtSize(a.tamanho)));
  item.append(link);
  if (isImg) item.append(el("span", "anexo-cap", a.nome || "imagem"));
  const del = el("button", "anexo-del"); del.type = "button"; del.setAttribute("aria-label", "Remover " + (a.nome || "anexo"));
  del.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  del.addEventListener("click", () => removerAnexo(a));
  item.append(del);
  return item;
}
async function anexar(files){
  const ed = S.ed; if (!ed || !files.length) return;
  const item = ed.item, pasta = (isPedidoTab(item.tab) ? "pedidos/" : "cards/") + item.id;
  setEdSaved("Enviando anexo…");
  for (const f of files){
    if (f.size > MAX_MB * 1048576){ toast(`"${f.name}" passa de ${MAX_MB} MB e não foi anexado.`); continue; }
    const tipo = f.type || "application/octet-stream";
    const nome = f.name && f.name !== "image.png" ? f.name : (tipo.startsWith("image/") ? `imagem-${new Date().toLocaleString("pt-BR").replace(/[/:, ]+/g, "-")}.${(tipo.split("/")[1] || "png").replace("jpeg", "jpg")}` : (f.name || "arquivo"));
    const path = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${seguro(nome)}`;
    const ok = await write(async () => {
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: tipo, upsert: false });
      if (up.error) throw up.error;
      const cur = (findItem(item.key) || item).anexos || [];
      await patchItem(item, { anexos: [...cur, { path, nome, tipo, tamanho: f.size, em: new Date().toISOString() }] });
    });
    if (!ok) break;
  }
  if (S.ed === ed){ setEdSaved("Salvo"); renderAnexos(); }
}
async function removerAnexo(a){
  const ed = S.ed; if (!ed) return;
  const item = ed.item;
  const depois = (item.anexos || []).filter(x => x.path !== a.path);
  if (await write(() => patchItem(item, { anexos: depois }))){
    renderAnexos();
    scheduleFileDelete(a.path, [a.path]);
    toast("Anexo removido.", { label: "Desfazer", run: async () => {
      cancelFileDelete(a.path);
      const cur = (findItem(item.key) || item).anexos || [];
      if (await write(() => patchItem(item, { anexos: [...cur, a] }))) renderAnexos();
    } });
  }
}
$("#ed-file").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; anexar(fs); });
const edBox = $("#editor");
edBox.addEventListener("paste", (e) => {
  const fs = [...((e.clipboardData && e.clipboardData.files) || [])];
  if (fs.length){ e.preventDefault(); anexar(fs); }
});
edBox.addEventListener("dragover", (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")){ e.preventDefault(); edBox.classList.add("is-drop"); }
});
edBox.addEventListener("dragleave", (e) => { if (!edBox.contains(e.relatedTarget)) edBox.classList.remove("is-drop"); });
edBox.addEventListener("drop", (e) => {
  edBox.classList.remove("is-drop");
  const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])];
  if (fs.length){ e.preventDefault(); anexar(fs); }
});
window.addEventListener("dragover", (e) => { if (S.ed && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (S.ed) e.preventDefault(); });

$("#ed-close").addEventListener("click", () => closeEditor());
ED.modal.querySelector("[data-close]").addEventListener("click", () => closeEditor());
$("#ed-delete").addEventListener("click", async () => {
  const it = await closeEditor(); if (!it) return;
  if (it.tab === "terceiros") removeRecebido(it);
  else if (it.tab === "enviados") removeEnviado(it);
  else removeSimple(it);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape"){
    if (S.drag){ endDrag(false); return; }
    if (S.ed){ e.preventDefault(); closeEditor(); return; }
  }
  if (e.key === "Tab" && S.ed){
    const f = [...$("#editor").querySelectorAll("button:not([disabled]),textarea,input:not([disabled]),[contenteditable=true]")].filter(n => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#editor"))){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
});
window.addEventListener("pagehide", () => { if (S.ed) saveEditor(S.ed); });

/* ---------- formulários ---------- */
function readPrio(name){ const r = document.querySelector(`input[name="prio-${name}"]:checked`); return prioOf(r && r.value); }
function resetPrio(name){ $(`#prio-${name}-media`).checked = true; }
function bindForm(formId, inputId, build){
  $(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $(inputId), texto = input.value.replace(/\s+/g, " ").trim();
    if (!texto){ input.focus(); return; }
    const job = build();
    if (!job) return;
    input.value = "";
    const ok = await write(() => job.save(texto));
    if (ok){ if (job.after) job.after(); }
    else { if (!input.value) input.value = texto; if (job.restore) job.restore(); }
    input.focus();
  });
}
bindForm("#form-lembretes", "#in-lembretes", () => {
  const dateEl = $("#date-lembretes"), quando = isDay(dateEl.value) ? dateEl.value : null, prioridade = readPrio("lembretes");
  return { save: (texto) => q(sb.from("cards").insert({ aba: "lembretes", texto, quando, prioridade })),
    after: () => { dateEl.value = ""; resetPrio("lembretes"); } };
});
function renderRecList(){
  const ativas = S.recs.filter(recAtiva);
  const wrap = $("#rec-wrap");
  wrap.hidden = !ativas.length;
  $("#rec-count").textContent = ativas.length;
  $("#rec-list").replaceChildren(...ativas.map(r => {
    const row = el("div", "rec-row");
    const mid = el("div", "rec-mid");
    mid.append(el("span", "rec-title", r.texto), el("span", "rec-desc", descRec(r)));
    const stop = el("button", "link-btn danger-btn", "Parar de repetir"); stop.type = "button";
    stop.addEventListener("click", () => pararRecorrencia(r));
    row.append(prioEl(r.prioridade), mid, stop);
    return row;
  }));
}
async function pararRecorrencia(r){
  const ontem = (() => { const d = parseDay(S.today); d.setDate(d.getDate() - 1); return localISO(d); })();
  const antes = r.fim;
  const ok = !r.ultima
    ? await write(() => q(sb.from("recorrencias").delete().eq("id", r.id)))
    : await write(() => q(sb.from("recorrencias").update({ fim: ontem }).eq("id", r.id)));
  if (!ok) return;
  const row = { id: r.id, texto: r.texto, notas: r.notas, prioridade: r.prioridade, frequencia: r.frequencia, dias_semana: r.dias, dia_mes: r.diaMes, inicio: r.inicio, fim: r.fim, ultima_gerada: r.ultima };
  toast(`"${r.texto}" não vai mais se repetir. O card de hoje, se já existir, continua na lista.`, { label: "Desfazer", run: () =>
    write(() => r.ultima ? q(sb.from("recorrencias").update({ fim: antes }).eq("id", r.id)) : q(sb.from("recorrencias").insert(row))) });
}
function syncRepUI(){
  const v = $("#rep-dia").value, extra = $("#rep-extra");
  extra.hidden = v === "nao";
  $("#rep-dias").hidden = v !== "semanal";
  $("#rep-mes-wrap").hidden = v !== "mensal";
  if (v !== "nao" && !$("#rep-inicio").value) $("#rep-inicio").value = S.diaDate > S.today ? S.diaDate : S.today;
  if (v === "mensal" && !$("#rep-mes").value){ const ini = $("#rep-inicio").value || S.today; $("#rep-mes").value = parseDay(ini).getDate(); }
  if (v === "semanal" && !document.querySelector("#rep-dias input:checked")){ const wd = parseDay($("#rep-inicio").value || S.today).getDay(); const c = $("#rep-d" + wd); if (c) c.checked = true; }
  $("#form-dia .btn").textContent = v === "nao" ? "Criar card" : "Criar recorrente";
}
$("#rep-dia").addEventListener("change", syncRepUI);
function resetRep(){
  $("#rep-dia").value = "nao"; $("#rep-inicio").value = ""; $("#rep-fim").value = ""; $("#rep-mes").value = "";
  document.querySelectorAll("#rep-dias input").forEach(c => { c.checked = false; });
  syncRepUI();
}
bindForm("#form-dia", "#in-dia", () => {
  const prioridade = readPrio("dia"), rep = $("#rep-dia").value;
  if (rep === "nao"){
    const quando = S.diaDate > S.today ? S.diaDate : null;
    return { save: (texto) => q(sb.from("cards").insert({ aba: "dia", texto, quando, prioridade })), after: () => resetPrio("dia") };
  }
  if (S.recsOff){ toast("As demandas recorrentes ainda não foram ativadas no Supabase. Rode o arquivo atualizacao-2-recorrentes.sql (veja o README)."); return null; }
  const inicio = isDay($("#rep-inicio").value) ? $("#rep-inicio").value : S.today;
  const fim = isDay($("#rep-fim").value) ? $("#rep-fim").value : null;
  const dias = [...document.querySelectorAll("#rep-dias input:checked")].map(c => Number(c.value));
  const diaMes = Math.min(31, Math.max(1, parseInt($("#rep-mes").value, 10) || parseDay(inicio).getDate()));
  if (fim && fim < inicio){ toast("A data final precisa ser depois da data de início."); return null; }
  if (rep === "semanal" && !dias.length){ toast("Escolha pelo menos um dia da semana."); return null; }
  return {
    save: (texto) => q(sb.from("recorrencias").insert({ texto, prioridade, frequencia: rep, dias_semana: rep === "semanal" ? dias : [], dia_mes: rep === "mensal" ? diaMes : null, inicio, fim })),
    after: async () => {
      resetPrio("dia"); resetRep();
      await loadRecorrencias(); await gerarRecorrencias(); renderAll();
      toast("Demanda recorrente criada. Ela aparece sozinha em Demandas do dia nos dias escolhidos.");
    }
  };
});
bindForm("#form-enviar", "#in-enviar", () => {
  const sel = $("#para-enviar"), para = sel.value;
  if (!para){ toast("Escolha para quem é a demanda."); sel.focus(); return null; }
  const notesEl = $("#notes-enviar"), notas = notesEl.value.slice(0, 20000), prioridade = readPrio("enviar");
  notesEl.value = "";
  return {
    save: (texto) => q(sb.from("pedidos").insert({ para, texto, notas, prioridade })),
    after: () => { resetPrio("enviar"); toast(`Demanda enviada para ${nomeDe(para)}.`); },
    restore: () => { if (!notesEl.value) notesEl.value = notas; }
  };
});
function fillParaSelect(){
  const sel = $("#para-enviar"), cur = sel.value;
  const opts = Object.values(S.perfis).filter(p => S.me && p.id !== S.me.id)
    .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, "pt-BR"));
  sel.replaceChildren(new Option(opts.length ? "Para quem?" : "Nenhum colega cadastrado ainda", ""));
  for (const p of opts) sel.append(new Option(p.nome ? `${p.nome} (${p.email})` : p.email, p.id));
  sel.value = opts.some(p => p.id === cur) ? cur : "";
}
$("#para-enviar").addEventListener("focus", () => { if (sb && S.me) loadPerfis().catch(() => {}); });

/* ---------- abas ---------- */
function activate(tab, focus){
  if (!S.visible.includes(tab)) tab = "dia";
  S.active = tab;
  for (const t of TABS){
    const on = t === tab, b = $("#tab-" + t), p = $("#panel-" + t);
    b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    p.hidden = !on; p.classList.toggle("is-first", S.visible[0] === t);
  }
  storeSet("org.aba", tab);
  try { $("#tab-" + tab).scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {}
  try { history.replaceState(null, "", "#" + tab); } catch {}
  if (tab === "calendario") renderCal();
  if (focus && window.matchMedia("(hover: hover)").matches){
    const inp = $("#in-" + tab); if (inp && !inp.disabled && inp.offsetParent) inp.focus();
  }
}
document.querySelectorAll(".tab").forEach(b => {
  b.addEventListener("click", () => { if (!S.drag) activate(b.dataset.tab, true); });
  b.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = S.visible.indexOf(S.active), step = e.key === "ArrowRight" ? 1 : -1;
    const next = S.visible[(idx + step + S.visible.length) % S.visible.length];
    activate(next, false); $("#tab-" + next).focus();
  });
});

/* ---------- tempo real ---------- */
function subscribe(){
  if (S.channel) sb.removeChannel(S.channel);
  const id = S.me.id;
  S.channel = sb.channel("organizador-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "cards", filter: `dono=eq.${id}` }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `para=eq.${id}` }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `de=eq.${id}` }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "recorrencias", filter: `dono=eq.${id}` }, scheduleReload)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSync(S.pending ? "saving" : "ok");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("off");
    });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me) scheduleReload(); });
window.addEventListener("online", () => { if (S.me) scheduleReload(); });

/* ---------- entrar / sair ---------- */
let authMode = "entrar";
function showView(view){
  $("#setup").hidden = view !== "setup";
  $("#auth").hidden = view !== "auth";
  $("#app").hidden = view !== "app";
}
function authMsg(text, kind){ const m = $("#auth-msg"); m.textContent = text || ""; m.className = "auth-msg" + (kind ? " " + kind : ""); }
function setAuthMode(mode){
  authMode = mode;
  $("#mode-entrar").setAttribute("aria-pressed", String(mode === "entrar"));
  $("#mode-criar").setAttribute("aria-pressed", String(mode === "criar"));
  $("#lbl-nome").hidden = mode !== "criar";
  $("#auth-btn").textContent = mode === "criar" ? "Criar conta" : "Entrar";
  $("#auth-senha").autocomplete = mode === "criar" ? "new-password" : "current-password";
  $("#auth-esqueci").hidden = mode === "criar";
  authMsg("");
}
$("#mode-entrar").addEventListener("click", () => setAuthMode("entrar"));
$("#mode-criar").addEventListener("click", () => setAuthMode("criar"));
function dominioOk(email){
  const dom = (CFG.dominioEmpresa || "").trim().toLowerCase();
  return !dom || email.toLowerCase().endsWith("@" + dom);
}
function traduzAuth(e){
  const m = (e && e.message) || "";
  if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/already registered|already exists/i.test(m)) return "Este e-mail já tem conta. Use a opção Entrar.";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/Password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/rate limit/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (/Database error saving new user/i.test(m)) return "Use seu e-mail da empresa para criar a conta.";
  return m || "Não foi possível continuar. Tente de novo.";
}
$("#form-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim(), senha = $("#auth-senha").value, nome = $("#auth-nome").value.trim();
  if (!email || !senha){ authMsg("Preencha e-mail e senha.", "erro"); return; }
  if (authMode === "criar"){
    if (!nome){ authMsg("Escreva seu nome.", "erro"); return; }
    if (!dominioOk(email)){ authMsg(`Use seu e-mail @${CFG.dominioEmpresa}.`, "erro"); return; }
    if (senha.length < 6){ authMsg("A senha precisa ter pelo menos 6 caracteres.", "erro"); return; }
  }
  const btn = $("#auth-btn"); btn.disabled = true; authMsg("Aguarde…");
  try {
    if (authMode === "criar"){
      const { data, error } = await sb.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) authMsg("Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.", "ok");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
    }
  } catch (err){ authMsg(traduzAuth(err), "erro"); }
  finally { btn.disabled = false; }
});
$("#auth-esqueci").addEventListener("click", async () => {
  const email = $("#auth-email").value.trim();
  if (!email){ authMsg("Escreva seu e-mail acima e clique de novo em Esqueci minha senha.", "erro"); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  authMsg(error ? traduzAuth(error) : "Se o e-mail tiver conta, enviamos um link para criar uma nova senha.", error ? "erro" : "ok");
});
$("#auth-ms").addEventListener("click", async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: location.origin + location.pathname } });
  if (error) authMsg(traduzAuth(error), "erro");
});
$("#form-nova-senha").addEventListener("submit", async (e) => {
  e.preventDefault();
  const senha = $("#nova-senha").value, msg = $("#nova-msg");
  if (senha.length < 6){ msg.textContent = "A senha precisa ter pelo menos 6 caracteres."; return; }
  const { error } = await sb.auth.updateUser({ password: senha });
  if (error){ msg.textContent = traduzAuth(error); return; }
  $("#form-nova-senha").hidden = true; $("#auth-main").hidden = false;
  const { data } = await sb.auth.getSession();
  if (data.session) start(data.session.user);
});
$("#btn-sair").addEventListener("click", async () => { if (S.ed) await closeEditor(); await sb.auth.signOut(); });

async function start(user){
  if (S.me && S.me.id === user.id) return;
  S.me = { id: user.id, email: user.email };
  showView("app");
  setToday();
  const fromHash = (location.hash || "").slice(1), saved = storeGet("org.aba");
  activate(TABS.includes(fromHash) ? fromHash : TABS.includes(saved) ? saved : "dia", false);
  renderAll();
  try { await loadPerfis(); } catch (e){ console.warn(e); }
  const me = S.perfis[user.id];
  const nameEl = $("#user-name"); nameEl.replaceChildren(avatarEl(user.id), el("span", null, (me && me.nome) || user.email));
  await reloadAll();
  subscribe();
}
function stop(){
  if (S.channel){ sb.removeChannel(S.channel); S.channel = null; }
  S.me = null; S.perfis = {};
  S.data = { lembretes: null, dia: null, terceiros: null, enviados: null };
  showView("auth"); setAuthMode("entrar");
}

function boot(){
  if (!sb){ showView("setup"); return; }
  $("#ms-wrap").hidden = !CFG.loginMicrosoft;
  if (CFG.dominioEmpresa) $("#auth-email").placeholder = "voce@" + CFG.dominioEmpresa;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY"){
      showView("auth"); $("#auth-main").hidden = true; $("#form-nova-senha").hidden = false; return;
    }
    if (session && session.user){ if (!$("#form-nova-senha").hidden) return; setTimeout(() => start(session.user), 0); }
    else stop();
  });
}

setInterval(() => {
  const t = localISO();
  if (t !== S.today){ if (S.diaDate === S.today) S.diaDate = t; S.today = t; setToday(); renderAll(); if (S.me) scheduleReload(); }
}, 60000);

boot();
})();
