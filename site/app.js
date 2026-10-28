// QER Dashboard: the whole front end.
// Reads the JSON files in site/data (built by `python -m qer.export`) and renders six views:
// Rankings, Week, Matchups, Quarterback, Compare, How QER Works. No framework, no build step:
// each view is a function that writes HTML into its <section>, and render() picks the view.
(() => {
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1 = v => v == null || isNaN(v) ? '–' : (+v).toFixed(1);
const f2 = v => v == null || isNaN(v) ? '–' : (+v).toFixed(2);
const C = { qer: '#4d9bff', pr: '#e2672f', qbr: '#22b07d', a: '#4d9bff', b: '#e2672f', c: '#22b07d', d: '#d39a1a', bonus: '#5b6878' };

// ---------- data
// Everything comes from site/data/*.json, written by `python -m qer.export` after each
// pipeline run. Seasons load on demand and are cached, so switching back is instant.
let MANIFEST = null, TEAM = {}, PL = {};
let S = null, GAMES = [], POWER = [], WEEKS = [], SCHED = [], INJ_ROWS = [], INJ = {}, INJ_WEEK = null;
let CURRENT = null, CAREER = null;
const cache = {};
const inflate = t => t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function loadSeason(season) {
  if (!cache[season]) {
    const d = await getJSON(`data/season_${season}.json`);
    cache[season] = { ...d, games: inflate(d.games), power: inflate(d.power), schedule: inflate(d.schedule), injuries: inflate(d.injuries) };
  }
  return cache[season];
}
async function loadCareer() {
  if (!CAREER) CAREER = inflate(await getJSON('data/career.json'));
  return CAREER;
}
function useSeason(d) { S = d; GAMES = d.games; POWER = d.power; WEEKS = d.weeks; SCHED = d.schedule; INJ_ROWS = d.injuries; }
// Injury status "as of" the selected week: the latest report up to the next game.
function refreshInjuries() {
  const rows = INJ_ROWS.filter(i => i.report_status && i.week <= state.week + 1);
  INJ_WEEK = rows.length ? Math.max(...rows.map(i => i.week)) : null;
  INJ = Object.fromEntries(rows.filter(i => i.week === INJ_WEEK).map(i => [i.player_id, i]));
}

const teamColor = ab => { const t = TEAM[ab]; if (!t) return '#33404f';
  const c = t.team_color; return lum(c) < .04 ? t.team_color2 : c; };
function lum(hex) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255; return .2126 * r + .7152 * g + .0722 * b; }
const nameOf = id => PL[id]?.name || id;
const initials = n => String(n).replace(/\b(Jr|Sr|II|III|IV)\.?$/,'').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const headshot = url => url ? url.replace('/upload/', '/upload/c_fill,g_face,w_256,h_256/') : '';
const photoOf = id => { const p = PL[id] || {}; return p.photo ? headshot(p.photo) : (p.photo_espn || ''); };

let state = { rf: { minGames: 2, hideInjured: false }, season: null, week: null, view: 'rankings', qb: null, mweek: null, xm: 'pr', sm: 'season', rby: 'power', rmetric: 'qer',
  cmp: { a: null, b: null, opp: '', from: null, to: null, type: 'all', metric: 'qer' } };
try { const r = JSON.parse(localStorage.getItem('qer.rank') || '{}'); if (r.rby) state.rby = r.rby; if (r.rmetric) state.rmetric = r.rmetric; if (r.rf) state.rf = { ...state.rf, ...r.rf }; } catch (e) {}
try { const v = localStorage.getItem('qer.view'); if (v) state.view = v; } catch (e) {}

function avatar(id, team, size = 36, showNum = false) {
  const nm = nameOf(id); const tc = teamColor(team);
  const url = photoOf(id);
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="av" style="--s:${size}px;--tc:${tc}"><b>${esc(initials(nm))}</b>${img}</span>`;
}
function injPill(id) {
  const i = INJ[id]; if (!i) return '';
  const cls = /out|doubtful|ir/i.test(i.report_status) ? 'inj out' : 'inj';
  return `<span class="${cls}" title="${esc(i.report_primary_injury || '')} · ${esc(i.practice_status || '')}">${esc(i.report_status)}${i.report_primary_injury ? ' · ' + esc(i.report_primary_injury) : ''}</span>`;
}
function moveChip(rc, back = false) {
  if (rc == null) return back
    ? '<span class="chip new" title="Back in the rankings after missing games (QBs drop out after 3 weeks without playing)">BACK</span>'
    : '<span class="chip new" title="Ranked for the first time this season (a QB needs 2 games to be ranked)">NEW</span>';
  if (rc > 0) return `<span class="chip up">▲ ${rc}</span>`;
  if (rc < 0) return `<span class="chip down">▼ ${-rc}</span>`;
  return '<span class="chip flat">–</span>';
}
const snap = w => POWER.filter(p => p.week === w);
const gamesThrough = (id, w) => GAMES.filter(g => g.qb_id === id && g.week <= w && g.dropbacks >= 10).sort((a, b) => a.week - b.week);

function spark(vals, w = 96, h = 26, color = C.qer) {
  if (vals.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const x = i => 3 + i * (w - 6) / (vals.length - 1), y = v => h - 3 - (v / 100) * (h - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = vals.length - 1;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${y(50)}" y2="${y(50)}" stroke="#232e3b" stroke-dasharray="2 3"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" opacity=".85"/>
    <circle cx="${x(last)}" cy="${y(vals[last])}" r="2.8" fill="${color}"/></svg>`;
}

// ---------- scoreboard strip (current season, current week) with live scores
// Live scores come straight from ESPN's public scoreboard feed in the visitor's browser.
// If it can't be reached, the strip falls back to the schedule from our data.
const ESPN_FIX = { WSH: 'WAS', LAR: 'LA' };
let LIVE = {}, liveTimer = null;
async function pollLive() {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    LIVE = {};
    for (const ev of j.events || []) {
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const side = {};
      for (const c of comp.competitors) side[c.homeAway] = { ab: ESPN_FIX[c.team.abbreviation] || c.team.abbreviation, score: c.score };
      LIVE[`${side.away.ab}@${side.home.ab}`] = { id: ev.id, as: side.away.score, hs: side.home.score, state: ev.status.type.state, detail: ev.status.type.shortDetail };
    }
    $('#strip-sub').textContent = 'Live scores · ESPN';
  } catch (e) {
    $('#strip-sub').textContent = 'Scores · schedule';
  }
  renderStrip();
  const anyLive = Object.values(LIVE).some(g => g.state === 'in');
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (!document.hidden) pollLive(); else liveTimer = setTimeout(pollLive, 60000); }, anyLive ? 30000 : 300000);
}
function renderStrip() {
  if (!CURRENT) return;
  const sched = CURRENT.schedule;
  const open = sched.filter(g => g.home_score == null).map(g => g.week);
  const wk = open.length ? Math.min(...open) : Math.max(...sched.map(g => g.week));
  $('#strip-title').textContent = `${CURRENT.season} · Week ${wk}`;
  const games = sched.filter(g => g.week === wk).sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime));
  $('#scores').innerHTML = games.map(g => {
    const lv = LIVE[`${g.away_team}@${g.home_team}`];
    const live = lv && lv.state === 'in', post = (lv && lv.state === 'post') || g.home_score != null;
    const as = lv && lv.state !== 'pre' ? lv.as : g.away_score, hs = lv && lv.state !== 'pre' ? lv.hs : g.home_score;
    const showScore = live || post;
    const row = (t, sc, lost) => `<div class="row ${lost ? 'lost' : ''}"><span class="t"><i style="--tc:${teamColor(t)}"></i>${t}</span>${showScore ? `<span class="s num">${sc ?? ''}</span>` : ''}</div>`;
    const d = new Date(g.gameday + 'T12:00:00');
    const when = live ? `<span class="live-dot"></span>${esc(lv.detail)}` : post ? 'Final' : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${fmtTime(g.gametime)} ET`;
    return `<div class="sc ${live ? 'is-live' : ''} ${lv ? 'clickable' : ''}" ${lv ? `data-live-game="${lv.id}" data-away="${g.away_team}" data-home="${g.home_team}" role="button" tabindex="0" title="Live QB stats and QER estimate"` : ''}>${row(g.away_team, as, post && +as < +hs)}${row(g.home_team, hs, post && +hs < +as)}<div class="st ${post ? 'final' : ''} ${live ? 'live' : ''}">${when}</div></div>`;
  }).join('');
}
function fmtTime(t) { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }

// ---------- ranking modes: what to rank by (Power / Season / Last 3) x which metric (QER / Passer / QBR)
const METRICS = {
  qer: { label: 'QER', short: 'QER', game: g => g.qer, scale: v => v },
  pr: { label: 'Passer rating', short: 'Passer', unit: ' (0–158.3)', game: g => g.passer_rating, scale: v => v / 158.3 * 100 },
  qbr: { label: 'ESPN QBR', short: 'QBR', game: g => g.qbr, scale: v => v },
};
const BY = { power: 'Power rating', season: 'Season average', last3: 'Last 3 games' };
function passerRating(c, a, y, t, i) {
  if (!a) return null; const cl = v => Math.max(0, Math.min(2.375, v));
  return Math.floor((cl((c / a - .3) * 5) + cl((y / a - 3) * .25) + cl(t / a * 20) + cl(2.375 - i / a * 25)) / 6 * 1000 + .5) / 10;
}
function metricValues(sn, W, metric) {
  const gl = gamesThrough(sn.qb_id, W), last = gl.slice(-3);
  if (metric === 'qer') return { season: sn.season_qer, last3: sn.last3_qer, trend: gl.map(g => g.qer) };
  if (metric === 'pr') {
    const sum = gs => gs.reduce((a, g) => [a[0] + g.comp, a[1] + g.att, a[2] + g.yds, a[3] + g.td, a[4] + g.ints], [0, 0, 0, 0, 0]);
    return { season: sn.season_passer_rating, last3: passerRating(...sum(last)), trend: gl.map(g => g.passer_rating / 158.3 * 100) };
  }
  const q = gl.filter(g => g.qbr != null), q3 = q.slice(-3);
  return { season: sn.season_qbr, last3: q3.length ? q3.reduce((a, g) => a + g.qbr, 0) / q3.length : null, trend: q.map(g => g.qbr) };
}
// Injury status as of a given week (the latest report up to that week's next game)
function injuredAt(week) {
  const rows = INJ_ROWS.filter(i => i.report_status && i.week <= week + 1);
  const wk = rows.length ? Math.max(...rows.map(i => i.week)) : null;
  return new Set(rows.filter(i => i.week === wk && /out|doubtful|ir|reserve/i.test(i.report_status)).map(i => i.player_id));
}
function ranking(W, metric, by) {
  const f = state.rf, hurt = f.hideInjured ? injuredAt(W) : new Set();
  const rows = snap(W).filter(p => p.ranked && p.games >= f.minGames && !hurt.has(p.qb_id)).map(sn => {
    const mv = metricValues(sn, W, metric);
    return { sn, ...mv, value: by === 'power' ? sn.power : by === 'season' ? mv.season : mv.last3 };
  }).filter(r => r.value != null);
  rows.sort((a, b) => b.value - a.value);
  rows.forEach((r, i) => r.rank = i > 0 && rows[i - 1].value === r.value ? rows[i - 1].rank : i + 1);
  return rows;
}
function seg(name, opts, cur, disabled = []) {
  return `<div class="wk-toggle" role="group" aria-label="${name}">${Object.entries(opts).map(([k, l]) =>
    `<button data-${name}="${k}" aria-pressed="${k === cur}" ${disabled.includes(k) ? 'disabled title="Power is built from QER only"' : ''}>${l}</button>`).join('')}</div>`;
}

// ---------- rankings
function renderRankings() {
  const W = state.week, metric = state.rmetric, by = state.rby;
  const rows = ranking(W, metric, by);
  const pi = WEEKS.indexOf(W);
  const prevRank = pi > 0 ? Object.fromEntries(ranking(WEEKS[pi - 1], metric, by).map(r => [r.sn.qb_id, r.rank])) : {};
  rows.forEach(r => {
    r.change = prevRank[r.sn.qb_id] == null ? null : prevRank[r.sn.qb_id] - r.rank;
    r.back = r.change == null && POWER.some(p => p.qb_id === r.sn.qb_id && p.week < W && p.ranked);
  });
  const s = snap(W), prov = s.filter(p => p.active && !p.ranked);
  const hiddenHurt = state.rf.hideInjured ? s.filter(p => p.ranked && injuredAt(W).has(p.qb_id)) : [];
  const hiddenFew = s.filter(p => p.ranked && p.games < state.rf.minGames);
  if (!rows.length) { $('#view-rankings').innerHTML = `<div class="panel empty"><h3>No QBs match these filters</h3><p>Lower the minimum games for week ${W}.</p></div>`; return; }
  const top = rows[0], tsn = top.sn;
  const movers = rows.filter(r => r.change != null);
  const up = [...movers].sort((a, b) => b.change - a.change).slice(0, 2).filter(r => r.change > 0);
  const down = [...movers].sort((a, b) => a.change - b.change).slice(0, 2).filter(r => r.change < 0);
  const rec = p => `${p.wins}-${p.losses}${p.ties ? '-' + p.ties : ''}`;
  const t = TEAM[tsn.team] || {};
  const M = METRICS[metric];
  const valLabel = by === 'power' ? 'Power' : `${M.short} · ${by === 'season' ? 'season' : 'last 3'}`;
  const fmtV = v => metric === 'qer' || by === 'power' ? f1(v) : f1(v);
  const scaled = r => by === 'power' ? r.value : M.scale(r.value);
  const vals = rows.map(scaled), lo = Math.min(...vals), hi = Math.max(...vals);
  const blurb = by === 'power'
    ? `Power blends each QB's ${state.season} QER with his own ${state.season - 1} season (league average for rookies). The more he plays, the more his ${state.season} games count. Built from QER only.`
    : `Ranked by ${M.label}, ${by === 'season' ? 'season average' : 'average of his last 3 games'}, through week ${W}. No adjustment for sample size.`;
  const others = ['qer', 'pr', 'qbr'].filter(k => k !== metric);
  const seasonOf = (sn, k) => k === 'qer' ? sn.season_qer : k === 'pr' ? sn.season_passer_rating : sn.season_qbr;
  $('#view-rankings').innerHTML = `
    <div class="sec-head"><div><div class="eyebrow">${BY[by]}${by === 'power' ? '' : ' · ' + M.label} · through week ${W}</div>
      <h2>${by === 'power' ? "Who's playing the best football right now" : `${M.label} rankings`}</h2>
      <p>${blurb}</p></div>
      <div class="controls"><div><span class="eyebrow">Rank by</span>${seg('rby', BY, by, metric === 'qer' ? [] : ['power'])}</div>
        <div><span class="eyebrow">Metric</span>${seg('rmetric', { qer: 'QER', pr: 'Passer rating', qbr: 'QBR' }, metric)}</div>
        <div><span class="eyebrow">Min games</span>${seg('rmin', { 2: '2+', 3: '3+', 4: '4+', 6: '6+' }, String(state.rf.minGames))}</div>
        <div><span class="eyebrow">Injured</span><div class="wk-toggle" role="group"><button data-rinj="1" aria-pressed="${state.rf.hideInjured}" title="Hide QBs listed Out, Doubtful or on IR in the latest injury report">${state.rf.hideInjured ? 'Hidden' : 'Shown'}</button></div></div></div></div>
    <div class="hero">
      <div class="panel hero-main" data-qb="${tsn.qb_id}" style="--tc:${teamColor(tsn.team)}" tabindex="0">
        ${avatar(tsn.qb_id, tsn.team, 108)}
        <div><div class="hero-rank">No. 1 · ${moveChip(top.change, top.back)}</div>
          <div class="hero-name">${esc(nameOf(tsn.qb_id))}</div>
          <div class="hero-team">${PL[tsn.qb_id]?.jersey ? '#' + esc(PL[tsn.qb_id].jersey) + ' · ' : ''}${esc(t.team_name || tsn.team)} · ${rec(tsn)} ${injPill(tsn.qb_id)}</div>
          <div class="hero-stats">
            <div class="stat"><small>Season QER</small><b class="num">${f1(tsn.season_qer)}</b></div>
            <div class="stat"><small>Last 3 QER</small><b class="num">${f1(tsn.last3_qer)}</b></div>
            <div class="stat"><small>Power</small><b class="num">${f1(tsn.power)}</b></div>
            <div class="stat"><small>Passer Rtg</small><b class="num">${f1(tsn.season_passer_rating)}</b></div>
            <div class="stat"><small>QBR</small><b class="num">${f1(tsn.season_qbr)}</b></div>
          </div></div>
        <div class="hero-power"><small>${valLabel}</small><b class="num">${fmtV(top.value)}</b><span>${tsn.games} games · ${tsn.dropbacks} DB</span></div>
      </div>
      <div class="panel side">
        <h3>Movers this week</h3>
        ${up.map(moverRow).join('') || '<span class="dim">No risers yet.</span>'}
        ${down.length ? '<div class="divider"></div>' + down.map(moverRow).join('') : ''}
      </div>
    </div>
    <div class="panel"><div class="tbl-wrap"><table>
      <thead><tr><th class="l">#</th><th class="l hide-sm"></th><th class="l">Quarterback</th><th>${valLabel}</th><th class="hide-sm">${M.short} trend</th>
        <th class="hide-sm">${by === 'season' ? `${M.short} last 3` : `${M.short} season`}</th>${by === 'power' ? '<th class="hide-sm">QER last 3</th>' : ''}
        ${others.map(k => `<th>${METRICS[k].short}</th>`).join('')}<th class="hide-sm">EPA/DB</th><th class="hide-sm">Rec</th></tr></thead>
      <tbody>${rows.map(r => { const p = r.sn; return `<tr data-qb="${p.qb_id}" class="${r.rank === 1 ? 'top1' : ''}">
        <td class="l rk num">${r.rank}</td><td class="l hide-sm">${moveChip(r.change, r.back)}</td>
        <td class="l"><div class="who">${avatar(p.qb_id, p.team, 36)}<div><b>${esc(nameOf(p.qb_id))}</b><span>${p.team} · ${p.games} GP</span> ${injPill(p.qb_id)}</div></div></td>
        <td><div class="pbar"><i style="--w:${hi === lo ? 100 : Math.max(4, (scaled(r) - lo) / (hi - lo) * 100)}%"></i><b class="num">${fmtV(r.value)}</b></div></td>
        <td class="hide-sm">${spark(r.trend)}</td>
        <td class="num hide-sm">${f1(by === 'season' ? r.last3 : r.season)}</td>${by === 'power' ? `<td class="num hide-sm">${f1(p.last3_qer)}</td>` : ''}
        ${others.map(k => `<td class="num">${f1(seasonOf(p, k))}</td>`).join('')}
        <td class="num hide-sm">${f2(p.epa_per_db)}</td><td class="num hide-sm dim">${rec(p)}</td></tr>`; }).join('')}</tbody>
    </table></div></div>
    ${hiddenHurt.length || hiddenFew.length ? `<p class="note">Hidden by filters: ${[...hiddenHurt.map(p => `${esc(nameOf(p.qb_id))} (injured)`), ...hiddenFew.map(p => `${esc(nameOf(p.qb_id))} (${p.games} GP)`)].join(' · ')}.</p>` : ''}
    <p class="note">NEW = ranked for the first time this season (2 games needed). BACK = returning after missing games. Other metric columns are season figures. Passer rating is on its usual 0–158.3 scale; trend lines scale it to 100. Trend shows each game's ${M.label.toLowerCase()}${metric === 'pr' ? ' (scaled to 100)' : ''}.${prov.length ? ` Provisional, too few games to rank: ${prov.map(p => `${esc(nameOf(p.qb_id))} (${p.team})`).join(' · ')}.` : ''}</p>`;
}
function moverRow(r) {
  const p = r.sn;
  return `<div class="mover" data-qb="${p.qb_id}">${avatar(p.qb_id, p.team, 40)}<div class="nm"><b>${esc(nameOf(p.qb_id))}</b><span>No. ${r.rank} · ${f1(r.value)}</span></div>${moveChip(r.change, r.back)}</div>`;
}

// ---------- week view
// Points of 100 each component contributed, using the weights/maxes the data was scored with
const P = () => MANIFEST.params;
const pts = g => ({ a: P().w_a * g.qer_a / P().a_max, b: P().w_b * g.qer_b / P().b_max, c: P().w_c * g.qer_c / P().c_max,
  d: P().w_d * g.qer_d / P().d_max, bonus: g.qer_bonus });
function stackBar(g) {
  const p = pts(g);
  return `<div class="stack" title="A ${f1(p.a)} · B ${f1(p.b)} · C ${f1(p.c)} · D ${f1(p.d)} · Win +${p.bonus}">${['a','b','c','d','bonus'].map(k => p[k] > 0 ? `<i style="width:${p[k]}%;background:${C[k]}"></i>` : '').join('')}</div>`;
}
// week label: regular-season weeks are numbers, playoff rounds get their names
function weekName(w) {
  const post = [...new Set(GAMES.filter(g => g.season_type === 'POST').map(g => g.week))].sort((a, b) => a - b);
  const i = post.indexOf(w);
  return i < 0 ? `Week ${w}` : (['Wild Card', 'Divisional', 'Conference', 'Super Bowl'][i + 4 - post.length] || `Week ${w}`);
}
function weekChips(W) {
  return `<div class="wkchips" role="group" aria-label="Choose a week">${WEEKS.map(w => {
    const n = weekName(w), short = n.startsWith('Week') ? w : ({ 'Wild Card': 'WC', Divisional: 'DIV', Conference: 'CONF', 'Super Bowl': 'SB' })[n];
    return `<button data-wk="${w}" aria-pressed="${w === W}" title="${n}">${short}</button>`; }).join('')}</div>`;
}
function renderWeek() {
  const W = state.week;
  const wk = GAMES.filter(g => g.week === W && g.dropbacks >= 14).sort((a, b) => b.qer - a.qer);
  // gold for the week's best start; green for #2-5 only in full regular-season weeks (not playoff rounds)
  const full = wk.length >= 10 && wk.every(g => g.season_type !== 'POST');
  const tier = i => i === 0 ? 'top1' : i < 5 && full ? 'top5' : '';
  $('#view-week').innerHTML = `
    ${weekChips(W)}
    <div class="sec-head"><div><div class="eyebrow">${state.season} · ${weekName(W)} · ${wk.length} starts</div><h2>Every start, ranked by QER</h2>
      <p>The bar shows where each score came from. Hover or tap a bar for the points. QER and QBR run 0–100; passer rating keeps its usual 0–158.3 scale. Gold = best start of the week; in full regular-season weeks, green = the rest of the top 5.</p></div>
      <div class="legend">${[['A · Accuracy', C.a], ['B · Efficiency', C.b], ['C · Scoring', C.c], ['D · Security', C.d], ['Win bonus', C.bonus]].map(([l, c]) => `<span><i style="--c:${c}"></i>${l}</span>`).join('')}</div></div>
    <div class="cards">${wk.map((g, i) => `
      <article class="panel gcard ${tier(i)}" data-qb="${g.qb_id}">
        <span class="wrank num">#${i + 1}</span>
        <div class="gtop">${avatar(g.qb_id, g.team, 46)}
          <div class="nm"><b>${esc(nameOf(g.qb_id))}</b><span>${g.result} ${g.pf}-${g.pa} ${g.home ? 'vs' : '@'} ${g.opp}</span></div>
          <div class="gq"><b class="num" style="color:${i === 0 ? 'var(--gold)' : 'var(--ink)'}">${f1(g.qer)}</b><span>QER</span></div></div>
        ${stackBar(g)}
        <div class="gline num">${g.comp}/${g.att} · ${g.yds} yds · ${g.td} TD · ${g.ints} INT · ${g.sacks} sk${g.sacks && g.sack_yds != null ? ` (${g.sack_yds > 0 ? "−" : ""}${g.sack_yds} yds)` : ''}${g.rush_att ? ` · ${g.rush_att} rush, ${g.rush_yds} yds` : ''}</div>
        <div class="gmeta"><span class="tag" title="Passer rating, 0–158.3 scale">Passer <b class="num">${f1(g.passer_rating)}</b></span><span class="tag" title="ESPN QBR, 0–100">QBR <b class="num">${f1(g.qbr)}</b></span><span class="tag" title="Expected points added per dropback: the standard analytics measure of QB efficiency">EPA/DB <b class="num">${f2(g.epa_per_db)}</b></span><span class="tag" title="Earned passing yards per dropback: the input to QER's B component">EPY/DB <b class="num">${f2(g.epy_per_db)}</b></span></div>
      </article>`).join('')}</div>
    <div class="split">
      <div class="panel chart-panel" id="scatter-panel"><div class="sec-head" style="margin-bottom:4px"><h3>QER vs ${state.xm === 'qbr' ? 'QBR' : 'passer rating'}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="sr" for="scatter-weeks">Which starts</label><select id="scatter-weeks" class="small-select" data-sw>
            <option value="season" ${state.sm === 'season' ? 'selected' : ''}>Season to date</option>
            <option value="all" ${state.sm === 'all' ? 'selected' : ''}>Whole season</option>
            ${WEEKS.map(w => `<option value="${w}" ${state.sm === w ? 'selected' : ''}>${weekName(w)} only</option>`).join('')}</select>
          <div class="wk-toggle" role="group" aria-label="Compare against"><button data-xm="pr" aria-pressed="${state.xm !== 'qbr'}">Passer rating</button><button data-xm="qbr" aria-pressed="${state.xm === 'qbr'}">QBR</button></div></div></div>
        <p>${typeof state.sm === 'number' ? `${state.season} ${weekName(state.sm)} starts only.` : state.sm === 'all' ? `Every ${state.season} start; ${weekName(W).toLowerCase()} is highlighted.` : `Every ${state.season} start through ${weekName(W).toLowerCase()}; ${weekName(W).toLowerCase()} is highlighted.`} <span id="scatter-r"></span></p><div id="scatter"></div></div>
      <div class="panel chart-panel"><h3>Where they disagree</h3><p>${weekName(W)} starts where QER differs most from passer rating (rescaled to 0–100: rating ÷ 158.3 × 100) and QBR.</p>${disagree(wk)}</div>
    </div>`;
  drawScatter(W);
}
function disagree(wk) {
  const rows = wk.map(g => {
    const dpr = g.qer - g.passer_rating / 158.3 * 100, dq = g.qbr == null ? null : g.qer - g.qbr;
    return { g, dpr, dq, d: dq == null ? dpr : (dpr + dq) / 2 };
  }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
  const gap = v => v == null ? '<span class="dim">–</span>' : `<span class="chip ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${f1(v)}</span>`;
  return `<div class="tbl-wrap"><table><thead><tr><th class="l">QB</th><th>QER</th><th>PR</th><th>QBR</th><th>vs PR</th><th>vs QBR</th><th class="l">Why</th></tr></thead><tbody>${rows.map(({ g, dpr, dq, d }) => `
    <tr data-qb="${g.qb_id}"><td class="l"><div class="who" style="min-width:0">${avatar(g.qb_id, g.team, 28)}<b>${esc(nameOf(g.qb_id))}</b></div></td>
    <td class="num"><b>${f1(g.qer)}</b></td><td class="num">${f1(g.passer_rating)}</td><td class="num">${f1(g.qbr)}</td>
    <td>${gap(dpr)}</td><td>${gap(dq)}</td>
    <td class="l dim" style="white-space:normal;min-width:190px;font-size:12.5px;line-height:1.4">${why(g, d)}</td></tr>`).join('')}</tbody></table></div>`;
}
function why(g, d) {
  // Name the QER part that is furthest from (or closest to) its maximum
  const parts = [
    ['a', g.qer_a / 2, `accuracy (CPOE ${g.cpoe > 0 ? '+' : ''}${f1(g.cpoe)})`],
    ['b', g.qer_b / 3, `yards created (${f2(g.epy_per_db)} EPY/DB)`],
    ['c', g.qer_c / 3, `credit on scoring drives`],
    ['d', g.qer_d / 2, `ball security (${g.sacks} sk, ${g.ints} INT)`]];
  parts.sort((x, y) => d < 0 ? x[1] - y[1] : y[1] - x[1]);
  const [, share, label] = parts[0];
  return (d < 0 ? 'Weakest: ' : 'Strongest: ') + label + ` · ${Math.round(share * 100)}% of max`;
}
function drawScatter(W) {
  const qbr = state.xm === 'qbr';
  const xv = g => qbr ? g.qbr : g.passer_rating;
  const pick = g => typeof state.sm === 'number' ? g.week === state.sm : state.sm === 'all' ? true : g.week <= W;
  const all = GAMES.filter(g => pick(g) && g.dropbacks >= 14 && xv(g) != null);
  const w = 560, h = 300, m = { l: 36, r: 12, t: 10, b: 32 };
  const [x0, x1] = qbr ? [0, 100] : [20, 160];
  const x = v => m.l + (v - x0) / (x1 - x0) * (w - m.l - m.r), y = v => h - m.b - v / 100 * (h - m.t - m.b);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Scatter of QER against passer rating">`;
  for (const v of [0, 25, 50, 75, 100]) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1c2633"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  for (const v of (qbr ? [0, 25, 50, 75, 100] : [40, 80, 120, 158.3])) s += `<text x="${x(v)}" y="${h - 12}" text-anchor="middle">${v === 158.3 ? '158' : v}</text>`;
  s += `<text x="${w - m.r}" y="${h - 1}" text-anchor="end">${qbr ? 'ESPN QBR' : 'passer rating'} →</text><text x="${m.l + 4}" y="${m.t + 8}">QER</text>`;
  const pts = all.map(g => ({ g, cx: x(Math.max(x0, xv(g))), cy: y(g.qer), hi: typeof state.sm === 'number' || g.week === W }));
  const n = all.length, mx = all.reduce((a, g) => a + xv(g), 0) / n, my = all.reduce((a, g) => a + g.qer, 0) / n;
  const r = all.reduce((a, g) => a + (xv(g) - mx) * (g.qer - my), 0) / Math.sqrt(all.reduce((a, g) => a + (xv(g) - mx) ** 2, 0) * all.reduce((a, g) => a + (g.qer - my) ** 2, 0));
  $('#scatter-r').textContent = `Correlation ${r.toFixed(2)} across ${n} starts.`;
  for (const p of pts.filter(p => !p.hi)) s += `<circle cx="${p.cx}" cy="${p.cy}" r="4" fill="#4d9bff" fill-opacity=".22" stroke="none"/>`;
  for (const p of pts.filter(p => p.hi)) s += `<circle cx="${p.cx}" cy="${p.cy}" r="5.5" fill="#4d9bff" stroke="#0a0e14" stroke-width="2"/>`;
  s += '</svg>';
  const host = $('#scatter'); host.innerHTML = s;
  const svg = host.querySelector('svg'), panel = $('#scatter-panel');
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; panel.appendChild(tip);
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * w, sy = (ev.clientY - r.top) / r.height * h;
    let best = null, bd = 18 * 18;
    for (const p of pts) { const dd = (p.cx - sx) ** 2 + (p.cy - sy) ** 2; if (dd < bd) { bd = dd; best = p; } }
    if (!best) { tip.hidden = true; return; }
    const g = best.g, pr = panel.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(nameOf(g.qb_id))}</b> · Wk ${g.week} ${g.home ? 'vs' : '@'} ${g.opp}<br>QER ${f1(g.qer)} · Passer ${f1(g.passer_rating)} · QBR ${f1(g.qbr)}`;
    tip.hidden = false;
    const left = Math.min(ev.clientX - pr.left + 12, pr.width - tip.offsetWidth - 8);
    tip.style.left = left + 'px'; tip.style.top = (ev.clientY - pr.top - 44) + 'px';
  });
  svg.addEventListener('pointerleave', () => tip.hidden = true);
}

// ---------- matchups
function qbForName(name, team) {
  if (!name) return null;
  const norm = s => (s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/, '').replace(/[^a-z]/g, '');
  const n = norm(name);
  const teamQbs = [...new Set(GAMES.filter(g => g.team === team).map(g => g.qb_id))];
  return teamQbs.find(id => norm(nameOf(id)) === n)
    || teamQbs.find(id => norm(nameOf(id)).endsWith(n.slice(-6)))
    || Object.keys(PL).find(id => norm(nameOf(id)) === n) || null;
}
function latestSnap(id) { const lim = Math.max(1, (state.mweek ?? state.week) - 1); const s = POWER.filter(p => p.qb_id === id && p.week <= lim); return s[s.length - 1]; }
function renderMatchups() {
  const allWeeks = [...new Set(SCHED.map(g => g.week))].sort((a, b) => a - b);
  const open = SCHED.filter(g => g.home_score == null).map(g => g.week);
  if (state.mweek == null || !allWeeks.includes(state.mweek)) state.mweek = open.length ? Math.min(...open) : state.week;
  const W = state.mweek, i = allWeeks.indexOf(W);
  const games = SCHED.filter(g => g.week === W).sort((a, b) => (a.gameday + a.gametime).localeCompare(b.gameday + b.gametime));
  const upcoming = games.some(g => g.home_score == null);
  $('#view-matchups').innerHTML = `
    <div class="sec-head"><div><div class="eyebrow">${state.season} · week ${W} · power ratings through week ${Math.min(state.week, W - 1) || state.week}</div><h2>QB matchups</h2>
      <p>${upcoming ? 'Projected starters from the schedule, with each QB\'s power rating going into the game' : 'Results, with each QB\'s power rating going into the game'}${INJ_WEEK ? ` and injury status (week ${INJ_WEEK} report)` : ''}.</p></div>
      <div class="wk-toggle" role="group" aria-label="Matchup week"><button data-mweek="${allWeeks[i - 1] ?? ''}" ${i <= 0 ? 'disabled' : ''}>‹ Week ${allWeeks[i - 1] ?? ''}</button><button aria-pressed="true">Week ${W}</button><button data-mweek="${allWeeks[i + 1] ?? ''}" ${i >= allWeeks.length - 1 ? 'disabled' : ''}>Week ${allWeeks[i + 1] ?? ''} ›</button></div></div>
    <div class="mgrid">${games.map(g => matchCard(g)).join('')}</div>`;
}
function matchCard(g) {
  const aid = qbForName(g.away_qb_name, g.away_team), hid = qbForName(g.home_qb_name, g.home_team);
  const as = aid && latestSnap(aid), hs = hid && latestSnap(hid);
  const fin = g.home_score != null;
  const d = new Date(g.gameday + 'T12:00:00');
  const side = (id, name, team, sn) => `<div class="mside" ${id ? `data-qb="${id}"` : ''}>${avatar(id || name, team, 56)}
    <b>${esc(id ? nameOf(id) : name || 'TBD')}</b><span>${team}${sn && sn.power_rank ? ` · No. ${sn.power_rank}` : ''}</span>
    <div class="pw num">${sn ? f1(sn.power) : '–'}<small>PWR</small></div>${id ? injPill(id) : ''}</div>`;
  const ap = as ? as.power : null, hp = hs ? hs.power : null;
  let edge = '';
  if (ap != null && hp != null) {
    const diff = ap - hp, wv = Math.min(100, Math.abs(diff) / 15 * 100);
    const fav = diff > 0 ? g.away_team : g.home_team;
    const line = g.spread_line == null ? '' : (g.spread_line > 0 ? `${g.home_team} −${g.spread_line}` : g.spread_line < 0 ? `${g.away_team} −${-g.spread_line}` : 'Pick');
    edge = `<div class="edge"><div class="edge-bar"><i style="--w:${diff > 0 ? wv : 0}%"></i><i style="--w:${diff < 0 ? wv : 0}%"></i></div>
      <div class="edge-txt"><span>QB edge <b>${Math.abs(diff) < .5 ? 'Even' : fav + ' +' + f1(Math.abs(diff))}</b></span><span>${line ? 'Line <b>' + line + '</b>' : ''}${g.total_line ? ` · O/U <b>${g.total_line}</b>` : ''}</span></div></div>`;
  }
  return `<article class="panel mcard">
    <div class="mhead"><span>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${fin ? '<span class="final">Final</span>' : fmtTime(g.gametime) + ' ET'}</span><span>${esc(g.stadium || '')}</span></div>
    <div class="mvs">${side(aid, g.away_qb_name, g.away_team, as)}
      ${fin ? `<div class="vs score num">${g.away_score}–${g.home_score}</div>` : '<div class="vs">@</div>'}
      ${side(hid, g.home_qb_name, g.home_team, hs)}</div>${edge}</article>`;
}

// ---------- QB detail
function qbOptions() {
  const s = snap(state.week).sort((a, b) => (a.power_rank ?? 99) - (b.power_rank ?? 99) || b.power - a.power);
  return s;
}
function renderQB() {
  const W = state.week, opts = qbOptions();
  if (!state.qb || !opts.some(o => o.qb_id === state.qb)) state.qb = opts[0].qb_id;
  const id = state.qb, sn = opts.find(o => o.qb_id === id), p = PL[id] || {}, gl = gamesThrough(id, W);
  const team = sn.team, t = TEAM[team] || {};
  const asOf = state.season === MANIFEST.current_season ? new Date() : new Date(`${state.season}-12-31`);
  const age = p.birth_date ? Math.floor((asOf - new Date(p.birth_date)) / 3.15576e10) : null;
  const ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : null;
  const draft = p.draft_round ? `${p.draft_year} R${p.draft_round} #${p.draft_pick} (${p.draft_team})` : (p.draft_year ? '' : 'Undrafted');
  const inj = INJ[id];
  $('#view-qb').innerHTML = `
    <div class="sec-head"><div><div class="eyebrow">Quarterback · through week ${W}</div></div>
      <div class="qb-pick"><label for="qb-select" class="eyebrow">Choose QB</label>
      <select id="qb-select">${opts.map(o => `<option value="${o.qb_id}" ${o.qb_id === id ? 'selected' : ''}>${o.power_rank ? o.power_rank + '. ' : ''}${esc(nameOf(o.qb_id))} (${o.team})</option>`).join('')}</select></div></div>
    <div class="panel qb-hero" style="--tc:${teamColor(team)}">
      ${avatar(id, team, 128, true)}
      <div><div class="hero-rank">${sn.power_rank ? 'Power rank No. ' + sn.power_rank : 'Provisional'} ${moveChip(sn.rank_change)}</div>
        <div class="hero-name">${esc(nameOf(id))}</div>
        <div class="hero-team">${p.jersey ? '#' + esc(p.jersey) + ' · ' : ''}${esc(t.team_name || team)} · ${sn.wins}-${sn.losses}${sn.ties ? '-' + sn.ties : ''} ${injPill(id)}</div>
        <div class="bio">${[age && `<span>Age <b>${age}</b></span>`, ht && `<span>Ht <b>${ht}</b></span>`, p.weight && `<span>Wt <b>${p.weight}</b></span>`, p.college && `<span>College <b>${esc(p.college)}</b></span>`, draft && `<span>Draft <b>${esc(draft)}</b></span>`, p.rookie_season && `<span>Season <b>${state.season - p.rookie_season + 1}</b></span>`].filter(Boolean).join('')}</div></div>
    </div>
    <div class="tiles2">
      <div class="panel tile hl" title="Power = his ${state.season} QER (${f1(sn.form_qer)}) blended with his starting point (${f1(sn.prior)}, from ${sn.prior_source}). With ${sn.dropbacks} dropbacks, his ${state.season} games count ${Math.round(sn.own_weight * 100)}%.">
        <small>Power rating</small><b class="num">${f1(sn.power)}</b>
        <span>${Math.round(sn.own_weight * 100)}% his ${state.season} QER (${f1(sn.form_qer)})<br>${Math.round((1 - sn.own_weight) * 100)}% ${sn.prior_source === 'last season' ? 'his adjusted ' + (state.season - 1) : 'league average'} (${f1(sn.prior)})</span></div>
      <div class="panel cmp"><div class="tbl-wrap"><table>
        <thead><tr><th class="l">Metric</th><th>Season</th><th>Last 3</th><th>Change</th><th>Best game</th><th class="hide-sm">By game</th></tr></thead>
        <tbody>${['qer', 'pr', 'qbr'].map(k => {
          const mv = metricValues(sn, W, k), M = METRICS[k];
          const best = Math.max(...gl.map(M.game).filter(v => v != null));
          const d = mv.last3 == null || mv.season == null ? null : mv.last3 - mv.season;
          const chg = sn.games <= 3 ? `<span class="dim">${sn.games} game${sn.games === 1 ? '' : 's'}</span>` : d == null ? '–' : Math.abs(d) < 1.5 ? '<span class="chip flat">steady</span>' : `<span class="chip ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${f1(Math.abs(d))}</span>`;
          return `<tr style="cursor:default" class="${k === 'qer' ? 'hl-row' : ''}"><td class="l"><b>${M.label}</b>${M.unit ? `<span class="dim" style="font-size:12px"> ${M.unit}</span>` : ''}</td><td class="num big">${f1(mv.season)}</td><td class="num big">${f1(mv.last3)}</td><td>${chg}</td><td class="num">${isFinite(best) ? f1(best) : '–'}</td><td class="hide-sm">${spark(mv.trend, 110, 26, k === 'qer' ? C.qer : k === 'pr' ? C.pr : C.qbr)}</td></tr>`;
        }).join('')}</tbody></table></div></div>
    </div>
    <div class="qb-grid">
      <div class="panel chart-panel" id="trend-panel"><h3>Game by game</h3><p>All three on a 0–100 scale (passer rating divided by 158.3).</p>
        <div class="legend" style="margin-bottom:6px"><span><i class="ln" style="--c:${C.qer}"></i>QER</span><span><i class="ln" style="--c:${C.pr}"></i>Passer rating</span><span><i class="ln" style="--c:${C.qbr}"></i>QBR</span></div>
        <div id="trend"></div></div>
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="panel chart-panel"><h3>What built each QER</h3><p>Points of 100, by component.</p>
          <div class="legend" style="margin-bottom:8px">${[['A', C.a], ['B', C.b], ['C', C.c], ['D', C.d], ['Win', C.bonus]].map(([l, c]) => `<span><i style="--c:${c}"></i>${l}</span>`).join('')}</div>
          <div style="display:flex;flex-direction:column;gap:8px">${gl.map(g => `<div style="display:grid;grid-template-columns:56px 1fr 40px;gap:10px;align-items:center;font-size:12px"><span class="dim">Wk ${g.week} ${g.opp}</span>${stackBar(g)}<b class="num" style="text-align:right">${f1(g.qer)}</b></div>`).join('')}</div></div>
        <div class="panel empty"><h3>Status &amp; news</h3>
          ${inj ? `<div class="status-card"><span>${injPill(id)}</span><span>Week ${inj.week} report: ${esc(inj.report_primary_injury || '')}. ${esc(inj.practice_status || '')}.</span></div>` : `<div class="status-card">${INJ_WEEK ? `Not on the week ${INJ_WEEK} injury report.` : 'No injury reports for this season.'}</div>`}
          <div class="ph"><i></i><span>Latest headlines for ${esc(nameOf(id))} will appear here once the news feed is connected.</span></div></div>
      </div>
    </div>
    <div class="panel"><div class="tbl-wrap"><table>
      <thead><tr><th class="l">Wk</th><th class="l">Opp</th><th class="l">Result</th><th>QER</th><th>Passer</th><th>QBR</th><th>C/Att</th><th>Yds</th><th>TD</th><th>INT</th><th title="Sacks taken and yards lost">Sacks (yds)</th><th title="Rushing attempts and yards">Rush (att–yds)</th><th>CPOE</th><th>EPY/DB</th><th>EPA/DB</th></tr></thead>
      <tbody>${gl.slice().reverse().map(g => `<tr style="cursor:default"><td class="l num">${g.week}</td><td class="l">${g.home ? 'vs' : '@'} ${g.opp}</td><td class="l">${g.result} ${g.pf}-${g.pa}</td>
        <td class="num"><b>${f1(g.qer)}</b></td><td class="num">${f1(g.passer_rating)}</td><td class="num">${f1(g.qbr)}</td><td class="num">${g.comp}/${g.att}</td><td class="num">${g.yds}</td><td class="num">${g.td}</td><td class="num">${g.ints}</td><td class="num">${g.sacks}${g.sacks && g.sack_yds != null ? ` <span class="dim">(${g.sack_yds > 0 ? '−' : ''}${g.sack_yds})</span>` : ''}</td><td class="num">${g.rush_att}–${g.rush_yds}</td><td class="num">${f1(g.cpoe)}</td><td class="num">${f2(g.epy_per_db)}</td><td class="num">${f2(g.epa_per_db)}</td></tr>`).join('')}</tbody></table></div></div>
    <div id="career"></div>`;
  drawTrend(gl);
  renderCareer(id);
  $('#qb-select').addEventListener('change', e => { state.qb = e.target.value; renderQB(); });
}
function drawTrend(gl) {
  const w = 620, h = 270, m = { l: 34, r: 14, t: 12, b: 30 };
  const weeks = gl.map(g => g.week); if (!weeks.length) { $('#trend').innerHTML = '<p class="dim">No games yet.</p>'; return; }
  const lo = Math.min(...weeks), hi = Math.max(...weeks);
  const x = v => hi === lo ? (m.l + w - m.r) / 2 : m.l + (v - lo) / (hi - lo) * (w - m.l - m.r), y = v => h - m.b - v / 100 * (h - m.t - m.b);
  const series = [['qer', g => g.qer, C.qer, 'QER'], ['pr', g => g.passer_rating / 158.3 * 100, C.pr, 'Passer rating'], ['qbr', g => g.qbr, C.qbr, 'QBR']];
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="QER, passer rating and QBR by week">`;
  for (const v of [0, 25, 50, 75, 100]) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1c2633"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  for (const g of gl) s += `<text x="${x(g.week)}" y="${h - 10}" text-anchor="middle">W${g.week}</text>`;
  s += `<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${h - m.b}" stroke="#3a4757" visibility="hidden"/>`;
  for (const [k, f, c] of series) {
    const pts = gl.filter(g => f(g) != null).map(g => [x(g.week), y(f(g))]);
    if (pts.length > 1) s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${k === 'qer' ? 2.5 : 2}" stroke-linejoin="round" ${k === 'qer' ? '' : 'opacity=".8"'}/>`;
    for (const p of pts) s += `<circle cx="${p[0]}" cy="${p[1]}" r="${k === 'qer' ? 4.5 : 3.5}" fill="${c}" stroke="#111821" stroke-width="2"/>`;
  }
  s += '</svg>';
  const host = $('#trend'); host.innerHTML = s;
  const svg = host.querySelector('svg'), panel = $('#trend-panel'), xh = svg.querySelector('#xh');
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; panel.appendChild(tip);
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * w;
    const g = gl.reduce((b, g) => Math.abs(x(g.week) - sx) < Math.abs(x(b.week) - sx) ? g : b, gl[0]);
    xh.setAttribute('x1', x(g.week)); xh.setAttribute('x2', x(g.week)); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>Week ${g.week}</b> ${g.home ? 'vs' : '@'} ${g.opp} · ${g.result} ${g.pf}-${g.pa}<br>` +
      series.map(([k, f, c, l]) => `<span class="k" style="--c:${c}"></span>${l} ${k === 'pr' ? f1(g.passer_rating) : f1(f(g))}`).join('<br>');
    tip.hidden = false;
    const pr = panel.getBoundingClientRect();
    tip.style.left = Math.min(ev.clientX - pr.left + 14, pr.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (ev.clientY - pr.top - 20) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}

// ---------- method
function renderMethod() {
  const p = P(), W = state.week;
  const aSlope = p.a_slope ?? p.a_max / (p.a_offset + p.a_full_cpoe);
  const dStart = p.d_start ?? p.d_max;
  const cPivotZ = p.c_pivot / p.c_slope, cUpper = (p.c_max - p.c_pivot) / (p.c_ceiling_z - cPivotZ);
  const bands = p.bonus_bands, vals = p.bonus_values;
  // worked example: chosen QB's latest game through the selected week
  const opts = snap(W).filter(o => o.ranked).sort((a, b) => a.power_rank - b.power_rank);
  if (!state.exQb || !opts.some(o => o.qb_id === state.exQb)) state.exQb = opts[0]?.qb_id;
  const g = gamesThrough(state.exQb, W).at(-1);
  const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let ex = '';
  if (g) {
    const A = clip(aSlope * (g.cpoe + p.a_offset), 0, p.a_max);
    const t = clip((g.epy_per_db - p.b_floor) / (p.b_ceiling - p.b_floor), 0, 1), B = p.b_max * t ** p.b_exponent;
    const z = g.credit_z, Cc = z <= cPivotZ ? p.c_slope * z : z < p.c_ceiling_z ? p.c_pivot + cUpper * (z - cPivotZ) : p.c_max;
    const cost = (p.d_w_int * g.int_cost + p.d_w_fumble * g.fumble_cost + p.d_w_sack * g.sack_cost) / g.dropbacks;
    const D = clip(dStart * (1 - clip(cost / p.d_zero_cost, 0, 1)), 0, p.d_max);
    const pa = p.w_a * A / p.a_max, pb = p.w_b * B / p.b_max, pc = p.w_c * Cc / p.c_max, pd = p.w_d * D / p.d_max, raw = pa + pb + pc + pd;
    const bonus = g.result === 'W' ? vals[bands.findIndex(b => raw <= b) === -1 ? vals.length - 1 : bands.findIndex(b => raw <= b)] : 0;
    const total = Math.min(p.final_cap, raw + bonus);
    const step = (k, name, c, inputs, math, ptsV, max) => `<tr><td class="l"><span class="dotkey" style="--c:${c}"></span><b>${k} · ${name}</b></td><td class="l">${inputs}</td><td class="l mono">${math}</td><td class="num"><b>${f1(ptsV)}</b> <span class="dim">/ ${max}</span></td></tr>`;
    ex = `
    <div class="panel ex">
      <div class="ex-head">${avatar(g.qb_id, g.team, 48)}<div><b>${esc(nameOf(g.qb_id))}</b><span>Week ${g.week} ${g.home ? 'vs' : '@'} ${g.opp} · ${g.result} ${g.pf}-${g.pa} · ${g.comp}/${g.att}, ${g.yds} yds, ${g.td} TD, ${g.ints} INT, ${g.sacks} sk</span></div>
        <label class="ex-pick"><span class="eyebrow">Example QB</span><select id="ex-qb">${opts.map(o => `<option value="${o.qb_id}" ${o.qb_id === state.exQb ? 'selected' : ''}>${esc(nameOf(o.qb_id))}</option>`).join('')}</select></label></div>
      <div class="tbl-wrap"><table class="ex-table"><thead><tr><th class="l">Component</th><th class="l">His numbers</th><th class="l">Math</th><th>Points</th></tr></thead><tbody>
        ${step('A', 'Accuracy', C.a, `CPOE ${g.cpoe > 0 ? '+' : ''}${f1(g.cpoe)}`, `${aSlope.toFixed(3)} × (${f1(g.cpoe)} + ${p.a_offset}) = ${A.toFixed(2)} of ${p.a_max}`, pa, p.w_a)}
        ${step('B', 'Efficiency', C.b, `${f1(g.epy)} EPY on ${g.dropbacks} dropbacks = ${f2(g.epy_per_db)} EPY/DB`, `${p.b_max} × ((${f2(g.epy_per_db)} − ${p.b_floor}) ÷ (${p.b_ceiling} − ${p.b_floor}))<sup>${p.b_exponent}</sup> = ${B.toFixed(2)} of ${p.b_max}`, pb, p.w_b)}
        ${step('C', 'Scoring', C.c, `${g.scoring_drives} scoring drive${g.scoring_drives === 1 ? '' : 's'}, z = ${z.toFixed(3)} credit per dropback`, z <= cPivotZ ? `${p.c_slope} × ${z.toFixed(3)} = ${Cc.toFixed(2)} of ${p.c_max} (steep part)` : `past the pivot: ${p.c_pivot} + ${cUpper.toFixed(2)} × (${z.toFixed(3)} − ${cPivotZ.toFixed(3)}) = ${Cc.toFixed(2)} of ${p.c_max}`, pc, p.w_c)}
        ${step('D', 'Security', C.d, `cost ${f2(g.int_cost)} INT + ${f2(g.fumble_cost)} fumble + ${f2(g.sack_cost)} sack EPA`, `(${p.d_w_int}×INT + ${p.d_w_fumble}×fum + ${p.d_w_sack}×sack) ÷ ${g.dropbacks} DB = ${cost.toFixed(3)} per DB → ${dStart} × (1 − ${cost.toFixed(3)} ÷ ${p.d_zero_cost}) = ${D.toFixed(2)} of ${p.d_max}`, pd, p.w_d)}
        <tr><td class="l"><span class="dotkey" style="--c:${C.bonus}"></span><b>Win bonus</b></td><td class="l">${g.result === 'W' ? 'Won' : 'Did not win'}</td><td class="l mono">${g.result === 'W' ? `raw ${f1(raw)} falls in the +${bonus} band` : 'no bonus'}</td><td class="num"><b>+${bonus}</b></td></tr>
        <tr class="total"><td class="l"><b>QER</b></td><td></td><td class="l mono">${f1(raw)} + ${bonus}${raw + bonus > p.final_cap ? `, capped at ${p.final_cap}` : ''}</td><td class="num"><b class="big">${f1(total)}</b></td></tr>
      </tbody></table></div>
      <p class="note">${Math.abs(total - g.qer) < 0.15 ? `Matches his stored QER of ${f1(g.qer)}: this table recomputes it live from the formula settings.` : `Stored QER is ${f1(g.qer)}; small differences come from rounding the inputs shown here.`}</p>
    </div>`;
  }
  const comps = [
    ['A', 'Accuracy', p.w_a, C.a, `CPOE (completion % over expected). Starts earning at CPOE −${p.a_offset}; full ${p.w_a} points at CPOE +${p.a_full_cpoe}, a straight line in between.`],
    ['B', 'Efficiency', p.w_b, C.b, `EPY per dropback. Zero at ${p.b_floor} or below (the worst 5% of games), full ${p.w_b} at ${p.b_ceiling} (the top 0.1%), on a curve that rewards getting from bad to average most.`],
    ['C', 'Scoring', p.w_c, C.c, `His share of each TD (${p.td_points} pts) and FG (${p.fg_points} pts) drive, per dropback. Climbs steeply until ${f2(p.c_pivot)} of ${p.c_max}, then gently up to the top 0.1% of games.`],
    ['D', 'Security', p.w_d, C.d, `Expected points lost per dropback to interceptions (×${p.d_w_int}), fumbles (×${p.d_w_fumble}) and sacks (×${p.d_w_sack}). Full ${p.w_d} for a clean game; zero only in the worst 3% of games.`]];
  const terms = [
    ['Play-by-play', 'A record of every snap of every game: who threw, ran or caught, the yards, the result, and model outputs like EPA. Everything QER uses comes from it (nflverse, 2006 onward).'],
    ['Dropback', 'A pass attempt or a sack: every play where the QB went back to pass. QER divides most things by dropbacks so long and short games compare fairly.'],
    ['EP · Expected points', 'How many points the offense is expected to score from this spot on the field, given down, distance, field position and time. 1st-and-10 at your own 25 is worth about +0.5; 1st-and-goal at the 2 about +5.'],
    ['EPA · Expected points added', 'EP after a play minus EP before it. A 3rd-and-8 completion for 9 yards might be +2; a sack on the same play might be −1.5; an interception often −4 or worse. The building block of C and D.'],
    ['EPA/DB · EPA per dropback', 'All the EPA from a QB\'s dropbacks and runs, divided by his dropbacks. The most widely used single number for QB efficiency in NFL analytics: for a starter\'s season (2006–2025), about +0.06 is typical, +0.15 is top quarter, and +0.22 or more is top 10%. Shown on this site as a benchmark next to QER.'],
    ['Completion probability', 'The chance an average QB completes a given throw, based on how far downfield it went, where, the down and distance, and pressure.'],
    ['CPOE · Completion % over expected', 'His actual completion rate minus the average of those probabilities. +5 means he completed 5 more passes per 100 than an average QB would have on the same throws. Input to A.'],
    ['Air yards', 'How far the ball travels past the line of scrimmage before it is caught.'],
    ['YAC · Yards after catch', 'Yards the receiver gains after the catch. Mostly the receiver\'s and scheme\'s doing, so QER discounts it.'],
    ['EPY · Earned passing yards', `Per completion: the air yards, plus ${Math.round(p.deep_yac_share * 100)}% of the YAC when the throw went ${p.deep_air_yards}+ air yards (a deep ball sets up the run after). Short-throw YAC earns nothing.`],
    ['EPY/DB', 'Earned passing yards per dropback (sacks count as dropbacks with zero yards). Input to B, and QER\'s most consistent ingredient.'],
    ['Scoring drive · drive EPA', 'A drive that ended in a TD or FG, and the total EPA of every play on it.'],
    ['Scoring credit · z', `On each scoring drive, the QB's share = (his pass EPA, with YAC filtered out like EPY, + ${p.rush_lambda} × his positive rush EPA) ÷ drive EPA, capped 0–1. Credit = share × points. z = total credit ÷ dropbacks. Input to C.`],
    ['Fumble cost', `Every fumble charged to the QB costs ${p.fumble_expected_cost} EPA (the average cost of a QB fumble), whoever recovers; a lost one adds ${Math.round(p.fumble_lost_extra * 100)}% of its actual cost. Center-charged bad snaps don't count.`],
    ['Raw score · win bonus', `A + B + C + D is the raw score (0–100). A win adds +${vals.join('/+')} for raw scores up to ${bands.join(' / ')} and above. Capped at ${p.final_cap}.`],
    ['Power rating', `A season rating built only from QER: his current-season QER blended with his own adjusted last season (league average for rookies). His dropbacks count against ${250} "starting point" dropbacks, and each week back counts 5% less.`],
    ['Percentile', 'Where a value ranks among all starts: the 5th percentile is lower than 95% of games; the top 0.1% is about 11 games since 2006.'],
    ['Passer rating', 'The NFL\'s official formula from completion %, yards, TDs and INTs per attempt. Runs 0–158.3. Doesn\'t count sacks, fumbles, rushing or game situation.'],
    ['ESPN QBR', 'ESPN\'s 0–100 rating built on EPA, weighted toward high-pressure moments, with rushing included. Published for each team\'s main QB in a game.']];
  $('#view-method').innerHTML = `
    <div class="sec-head"><div><div class="eyebrow">QER v${esc(MANIFEST.qer_version)}</div><h2>How QER works</h2>
      <p>Each game gets a score from 0 to 100, built from four parts worth ${p.w_a}, ${p.w_b}, ${p.w_c} and ${p.w_d} points. A win adds 1 to 5 more depending on how good the game already was.</p></div></div>
    <div class="comp-grid">${comps.map(([k, n, w, c, d]) => `<div class="panel comp" style="--c:${c}"><b>${w}<small>pts</small></b><h4>${k} · ${n}</h4><p>${d}</p></div>`).join('')}</div>

    <div class="sec-head" style="margin-top:28px"><div><div class="eyebrow">Worked example · through week ${W}</div><h2>One game, step by step</h2>
      <p>Every number below is computed in your browser from the same settings the pipeline used.</p></div></div>
    ${ex || '<p class="note">No games yet this season.</p>'}

    <div class="sec-head" style="margin-top:28px"><div><div class="eyebrow">Glossary</div><h2>Terms</h2></div></div>
    <dl class="glossary">${terms.map(([t, d]) => `<div class="panel"><dt>${t}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>

    <div class="sec-head" style="margin-top:28px"><div><div class="eyebrow">Behind the numbers</div><h2>Where the data comes from</h2>
      <p>Everything runs on free, public NFL data.</p></div></div>
    <div class="flow">
      <div class="panel"><div class="step">1 · SOURCE</div><h4>nflverse</h4><p>Free play-by-play for every NFL game, with EPA and CPOE already calculated. Updated overnight after games. Also schedules, injury reports, ESPN QBR and player photos.</p></div>
      <div class="panel"><div class="step">2 · DATABASE</div><h4>SQL database</h4><p>The pipeline stores every play in a <code>plays</code> table, in Postgres online or a SQLite file locally.</p></div>
      <div class="panel"><div class="step">3 · COMPUTE</div><h4>QER + power</h4><p>Python reads the plays back out of the database, scores each game, and writes <code>qb_games</code> and <code>power_ratings</code>.</p></div>
      <div class="panel"><div class="step">4 · DISPLAY</div><h4>This page</h4><p>Reads the computed results. A scheduled job repeats steps 1–3 every morning; live scores come from ESPN during games.</p></div>
    </div>
    <div class="prose" style="margin-top:28px">
    <p><b>Calibration.</b> Each component's scale is set from all 11,048 starts from 2006–2025: B earns nothing only in the worst 5% of games, D hits zero only in the worst 3%, and ceilings sit at the top 0.1% of games, so no single fluke game sets the scale.</p>
    <p><b>Sacks and groundings.</b> A sack counts against the QB who was on the field for it. An intentional grounding counts once, as the incomplete pass it is. A strip-sack counts as both a sack and a fumble.</p>
    <p><b>Power rating.</b> After 2 games a QB's current season counts about 20%; after 6, about 40%; after a full season, about 70%. Backtested on 2006–2025: starting from his own adjusted last season predicted rest-of-season QER about 4% better than starting everyone at the league average.</p></div>`;
  const sel = $('#ex-qb'); if (sel) sel.addEventListener('change', e => { state.exQb = e.target.value; renderMethod(); });
}

// ---------- QB career (all seasons, from career.json)
async function renderCareer(id) {
  const host = $('#career'); if (!host) return;
  host.innerHTML = '<p class="note">Loading career…</p>';
  const rows = (await loadCareer()).filter(g => g.qb_id === id);
  if (state.qb !== id || !$('#career')) return;          // the user moved on while loading
  const by = {};
  for (const g of rows) (by[g.season] ||= []).push(g);
  const seasons = Object.keys(by).map(Number).sort((a, b) => b - a);
  const line = s => {
    const gs = by[s], q = gs.filter(g => g.qbr != null);
    const sum = k => gs.reduce((a, g) => a + (g[k] || 0), 0);
    const teams = [...new Set(gs.map(g => g.team))].join('/');
    const w = gs.filter(g => g.result === 'W').length, l = gs.filter(g => g.result === 'L').length;
    return { s, teams, gp: gs.length, rec: `${w}-${l}`, qer: gs.reduce((a, g) => a + g.qer, 0) / gs.length,
      best: Math.max(...gs.map(g => g.qer)), pr: passerRating(sum('comp'), sum('att'), sum('yds'), sum('td'), sum('ints')),
      qbr: q.length ? q.reduce((a, g) => a + g.qbr, 0) / q.length : null, yds: sum('yds'), td: sum('td'), ints: sum('ints') };
  };
  const L = seasons.map(line);
  host.innerHTML = `
    <div class="sec-head" style="margin-top:28px"><div><div class="eyebrow">All seasons since 2006 · regular season and playoffs</div><h3>Career by season</h3></div>
      <button class="btn" data-compare="${id}">Compare with another QB ›</button></div>
    <div class="panel"><div class="tbl-wrap"><table>
      <thead><tr><th class="l">Season</th><th class="l">Team</th><th>GP</th><th>Rec</th><th>Avg QER</th><th>Best</th><th>Passer</th><th>QBR</th><th>Yds</th><th>TD</th><th>INT</th></tr></thead>
      <tbody>${L.map(r => `<tr data-season-go="${r.s}" class="${r.s === state.season ? 'hl-row' : ''}"><td class="l num"><b>${r.s}</b></td><td class="l">${r.teams}</td><td class="num">${r.gp}</td><td class="num dim">${r.rec}</td>
        <td><div class="pbar"><i style="--w:${Math.max(4, r.qer)}%"></i><b class="num">${f1(r.qer)}</b></div></td><td class="num">${f1(r.best)}</td><td class="num">${f1(r.pr)}</td><td class="num">${f1(r.qbr)}</td>
        <td class="num">${r.yds}</td><td class="num">${r.td}</td><td class="num">${r.ints}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="note">Click a season to open it.</p>`;
}

// ---------- Compare: any two QBs, any seasons, any opponent (from career.json)
const CMP_COLORS = ['#4d9bff', '#e2672f'];
const CM = {
  qer: { label: 'QER', get: g => g.qer, max: 100, bins: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], step: 10 },
  pr: { label: 'Passer rating', get: g => g.passer_rating, max: 158.3, bins: [0, 20, 40, 60, 80, 100, 120, 140], step: 20 },
  qbr: { label: 'ESPN QBR', get: g => g.qbr, max: 100, bins: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90], step: 10 },
};
function qbList() {
  // QBs with at least 8 career starts, most career games first
  const n = {};
  for (const g of CAREER) n[g.qb_id] = (n[g.qb_id] || 0) + 1;
  return Object.keys(n).filter(id => n[id] >= 8).sort((a, b) => n[b] - n[a] || nameOf(a).localeCompare(nameOf(b)));
}
function cmpRows(id) {
  const c = state.cmp;
  return CAREER.filter(g => g.qb_id === id && (!c.opp || g.opp === c.opp) && g.season >= c.from && g.season <= c.to
    && (c.type === 'all' || (c.type === 'reg' ? g.season_type === 'REG' : g.season_type === 'POST')));
}
function cmpSummary(gs) {
  if (!gs.length) return null;
  const sum = k => gs.reduce((a, g) => a + (g[k] || 0), 0), q = gs.filter(g => g.qbr != null);
  const db = sum('dropbacks'), qs = gs.map(g => g.qer).sort((a, b) => a - b);
  return { gp: gs.length, w: gs.filter(g => g.result === 'W').length, l: gs.filter(g => g.result === 'L').length,
    qer: sum('qer') / gs.length, med: qs[Math.floor(gs.length / 2)],
    elite: gs.filter(g => g.qer >= 80).length, poor: gs.filter(g => g.qer < 30).length,
    pr: passerRating(sum('comp'), sum('att'), sum('yds'), sum('td'), sum('ints')),
    qbr: q.length ? q.reduce((a, g) => a + g.qbr, 0) / q.length : null,
    epa: gs.reduce((a, g) => a + g.epa_per_db * g.dropbacks, 0) / db, yds: sum('yds') / gs.length,
    td: sum('td'), ints: sum('ints'), tdpg: sum('td') / gs.length, intpg: sum('ints') / gs.length };
}
// "Tale of the tape": each stat as two bars growing out from the middle, one per QB
function tapeRow(label, a, b, fmt = f1, higher = true) {
  if (a == null && b == null) return '';
  const lo = Math.min(0, a ?? 0, b ?? 0), hi = Math.max(a ?? 0, b ?? 0) || 1;
  const w = v => v == null ? 0 : Math.max(3, (v - lo) / (hi - lo) * 100);
  const win = a == null || b == null || a === b ? 0 : ((a > b) === higher ? 1 : 2);
  return `<div class="tape-row">
    <div class="tape-side l ${win === 1 ? 'won' : ''}"><span class="v num">${win === 1 ? '▲ ' : ''}${fmt(a)}</span><i style="width:${w(a)}%;background:${CMP_COLORS[0]}"></i></div>
    <div class="tape-label">${label}</div>
    <div class="tape-side r ${win === 2 ? 'won' : ''}"><i style="width:${w(b)}%;background:${CMP_COLORS[1]}"></i><span class="v num">${fmt(b)}${win === 2 ? ' ▲' : ''}</span></div></div>`;
}
async function renderCompare() {
  const host = $('#view-compare');
  if (!CAREER) { host.innerHTML = '<p class="note">Loading every QB game since 2006…</p>'; await loadCareer(); if (state.view !== 'compare') return; }
  const c = state.cmp, list = qbList(), seasons = MANIFEST.seasons.map(s => s.season);
  const byName = n => list.find(id => nameOf(id) === n);
  c.a ||= byName('Tom Brady') || list[0];
  c.b ||= byName('Peyton Manning') || list[1];
  c.from ??= seasons[0]; c.to ??= seasons[seasons.length - 1];
  c.metric ||= 'qer';
  const M = CM[c.metric];
  const A = cmpRows(c.a), B = cmpRows(c.b), sa = cmpSummary(A), sb = cmpSummary(B);
  const teams = Object.keys(TEAM).filter(t => !['LAR', 'OAK', 'SD', 'STL'].includes(t)).sort();
  const opt = (v, cur, label = v) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const int = v => v == null ? '–' : String(Math.round(v));
  // same game = same season, week and type, with each QB's team being the other's opponent
  const sameGame = (g, h) => g.season === h.season && g.week === h.week && g.season_type === h.season_type
    && g.team === h.opp && g.opp === h.team;
  const shared = A.filter(g => B.some(h => sameGame(g, h)));
  const head = (id, gs, i) => `<div class="cmp-qb ${i ? 'right' : ''}" data-qb-career="${id}" style="--qc:${CMP_COLORS[i]}">
      ${i ? '' : avatar(id, gs.at(-1)?.team, 72)}<div><b>${esc(nameOf(id))}</b><span>${gs.length} games${c.opp ? ' vs ' + c.opp : ''} · ${c.from === c.to ? c.from : c.from + '–' + c.to}</span></div>${i ? avatar(id, gs.at(-1)?.team, 72) : ''}</div>`;
  host.innerHTML = `
    <div class="sec-head"><div><div class="eyebrow">Compare · every QB start since 2006</div><h2>Head to head</h2>
      <p>Pick two QBs and narrow it down by opponent, seasons or playoffs. Example: Brady vs Peyton, only against Baltimore.</p></div>
      <div class="controls"><div><span class="eyebrow">Charts and logs show</span>${seg('cmetric', { qer: 'QER', pr: 'Passer rating', qbr: 'QBR' }, c.metric)}</div></div></div>
    <div class="panel cmp-controls">
      <label>QB 1<input id="cmp-a" list="qb-names" value="${esc(nameOf(c.a))}" autocomplete="off"></label>
      <label>QB 2<input id="cmp-b" list="qb-names" value="${esc(nameOf(c.b))}" autocomplete="off"></label>
      <datalist id="qb-names">${list.map(id => `<option value="${esc(nameOf(id))}">`).join('')}</datalist>
      <label>Opponent<select id="cmp-opp">${opt('', c.opp, 'Any team')}${teams.map(t => opt(t, c.opp, `vs ${t}`)).join('')}</select></label>
      <label>From<select id="cmp-from">${seasons.map(s => opt(s, c.from)).join('')}</select></label>
      <label>To<select id="cmp-to">${seasons.map(s => opt(s, c.to)).join('')}</select></label>
      <label>Games<select id="cmp-type">${opt('all', c.type, 'All')}${opt('reg', c.type, 'Regular season')}${opt('post', c.type, 'Playoffs')}</select></label>
    </div>
    <div class="cmp-head">${head(c.a, A, 0)}<div class="vs">vs</div>${head(c.b, B, 1)}</div>
    ${!sa || !sb ? `<div class="panel empty"><p>${!sa ? esc(nameOf(c.a)) : esc(nameOf(c.b))} has no games that match these filters. Try a wider season range or another opponent.</p></div>` : `
    <div class="split" style="margin-top:0">
      <div class="panel tape">
        ${tapeRow('Avg QER', sa.qer, sb.qer)}${tapeRow('Median QER', sa.med, sb.med)}
        ${tapeRow('Games 80+ QER', sa.elite, sb.elite, int)}${tapeRow('Games under 30', sa.poor, sb.poor, int, false)}
        ${tapeRow('Passer rating', sa.pr, sb.pr)}${tapeRow('ESPN QBR', sa.qbr, sb.qbr)}${tapeRow('EPA / dropback', sa.epa, sb.epa, f2)}
        ${tapeRow('Yards / game', sa.yds, sb.yds, int)}${tapeRow('TD / game', sa.tdpg, sb.tdpg, f2)}${tapeRow('INT / game', sa.intpg, sb.intpg, f2, false)}
        <div class="tape-row"><div class="tape-side l"><span class="v num">${sa.w}-${sa.l}</span></div><div class="tape-label">Record</div><div class="tape-side r"><span class="v num">${sb.w}-${sb.l}</span></div></div>
        <p class="note">▲ marks the better number. Totals: ${sa.td} TD / ${sa.ints} INT vs ${sb.td} TD / ${sb.ints} INT.</p>
      </div>
      <div class="panel chart-panel"><h3>${M.label} by game</h3><p>Share of each QB's games in each range.</p>
        <div class="legend" style="margin-bottom:6px"><span><i style="--c:${CMP_COLORS[0]}"></i>${esc(nameOf(c.a))}</span><span><i style="--c:${CMP_COLORS[1]}"></i>${esc(nameOf(c.b))}</span></div>
        ${histogram(A, B, M)}</div>
    </div>
    <div class="panel chart-panel" style="margin-top:16px">${trendChart(A, B, M)}</div>
    ${shared.length ? `<div class="panel h2h"><h3>When they faced each other</h3><div class="tbl-wrap"><table>
      <thead><tr><th class="l">Season</th><th class="l">Wk</th><th class="l">Game</th><th>${esc(nameOf(c.a))}</th><th>${esc(nameOf(c.b))}</th><th class="l">Winner</th></tr></thead>
      <tbody>${shared.map(g => { const h = B.find(x => sameGame(g, x)); return `<tr style="cursor:default"><td class="l num">${g.season}</td><td class="l num">${g.season_type === 'POST' ? 'PO' : g.week}</td>
        <td class="l">${g.team} ${g.home ? 'vs' : '@'} ${g.opp} · ${g.pf}-${g.pa}</td><td class="num"><b style="color:${CMP_COLORS[0]}">${f1(M.get(g))}</b></td><td class="num"><b style="color:${CMP_COLORS[1]}">${f1(M.get(h))}</b></td>
        <td class="l">${g.result === 'W' ? esc(nameOf(c.a)) : h.result === 'W' ? esc(nameOf(c.b)) : 'Tie'}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
    <div class="cmp-logs">${gameLog(c.a, A, 0, M)}${gameLog(c.b, B, 1, M)}</div>`}`;
  const pick = (el, key) => el.addEventListener('change', () => { const id = byName(el.value); if (id) { c[key] = id; renderCompare(); } });
  pick($('#cmp-a'), 'a'); pick($('#cmp-b'), 'b');
  $('#cmp-opp').addEventListener('change', e => { c.opp = e.target.value; renderCompare(); });
  $('#cmp-from').addEventListener('change', e => { c.from = +e.target.value; if (c.to < c.from) c.to = c.from; renderCompare(); });
  $('#cmp-to').addEventListener('change', e => { c.to = +e.target.value; if (c.from > c.to) c.from = c.to; renderCompare(); });
  $('#cmp-type').addEventListener('change', e => { c.type = e.target.value; renderCompare(); });
}
function gameLog(id, gs, i, M) {
  const rows = [...gs].sort((x, y) => y.season - x.season || y.week - x.week);
  return `<div class="panel cmp-log" style="--qc:${CMP_COLORS[i]}">
    <div class="cmp-log-head">${avatar(id, gs.at(-1)?.team, 32)}<b>${esc(nameOf(id))}</b><span>${gs.length} games</span></div>
    <div class="tbl-wrap"><table><thead><tr><th class="l">Season</th><th class="l">Wk</th><th class="l">Opp</th><th class="l">Result</th><th>${M === CM.pr ? 'Passer' : M.label}</th><th>C/Att</th><th>Yds</th><th>TD-INT</th></tr></thead>
    <tbody>${rows.map(g => { const v = M.get(g); return `<tr style="cursor:default"><td class="l num">${g.season}</td><td class="l num">${g.season_type === 'POST' ? 'PO' : g.week}</td>
      <td class="l">${g.home ? 'vs' : '@'} ${g.opp}</td><td class="l ${g.result === 'W' ? 'res-w' : g.result === 'L' ? 'res-l' : ''}">${g.result} ${g.pf}-${g.pa}</td>
      <td><div class="pbar"><i style="--w:${v == null ? 0 : Math.max(3, v / M.max * 100)}%;--bc:${CMP_COLORS[i]}"></i><b class="num">${f1(v)}</b></div></td>
      <td class="num">${g.comp}/${g.att}</td><td class="num">${g.yds}</td><td class="num">${g.td}-${g.ints}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function histogram(A, B, M) {
  const bins = M.bins, w = 560, h = 230, m = { l: 34, r: 8, t: 8, b: 28 };
  const inBin = (v, lo, i) => v != null && v >= lo && (i === bins.length - 1 ? v <= M.max + .01 : v < bins[i + 1]);
  const share = gs => { const n = gs.filter(g => M.get(g) != null).length || 1; return bins.map((lo, i) => gs.filter(g => inBin(M.get(g), lo, i)).length / n * 100); };
  const a = share(A), b = share(B), top = Math.max(10, ...a, ...b);
  const bw = (w - m.l - m.r) / bins.length, y = v => h - m.b - v / top * (h - m.t - m.b);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Share of games in each ${M.label} range">`;
  for (const v of [0, top / 2, top]) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1c2633"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}%</text>`;
  bins.forEach((lo, i) => {
    const x = m.l + i * bw, bar = (bw - 8) / 2, hiLab = i === bins.length - 1 ? (M.max === 100 ? 100 : 158) : bins[i + 1];
    s += `<rect x="${x + 3}" y="${y(a[i])}" width="${bar}" height="${h - m.b - y(a[i])}" rx="2" fill="${CMP_COLORS[0]}"><title>${lo}–${hiLab}: ${a[i].toFixed(0)}% of games</title></rect>`;
    s += `<rect x="${x + 5 + bar}" y="${y(b[i])}" width="${bar}" height="${h - m.b - y(b[i])}" rx="2" fill="${CMP_COLORS[1]}"><title>${lo}–${hiLab}: ${b[i].toFixed(0)}% of games</title></rect>`;
    s += `<text x="${x + bw / 2}" y="${h - 10}" text-anchor="middle">${lo}</text>`;
  });
  return s + '</svg>';
}
// One season selected: game-by-game lines. Several seasons: season averages.
function trendChart(A, B, M) {
  const seasonsIn = new Set([...A, ...B].map(g => g.season));
  const w = 900, h = 250, m = { l: 38, r: 14, t: 10, b: 30 };
  const y = v => h - m.b - v / M.max * (h - m.t - m.b);
  const ticks = M.max === 100 ? [0, 25, 50, 75, 100] : [0, 40, 80, 120, 158.3];
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${M.label} trend">`;
  for (const v of ticks) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1c2633"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  let title, sub, series;
  if (seasonsIn.size <= 1) {
    title = `${M.label} game by game`; sub = 'In order, regular season then playoffs.';
    const ord = gs => [...gs].sort((x, z) => x.week - z.week).filter(g => M.get(g) != null);
    const a = ord(A), b = ord(B), n = Math.max(a.length, b.length, 2);
    const x = i => m.l + i / (n - 1) * (w - m.l - m.r);
    series = [a, b].map(gs => gs.map((g, i) => [x(i), M.get(g), `${g.season_type === 'POST' ? 'Playoffs' : 'Wk ' + g.week} ${g.home ? 'vs' : '@'} ${g.opp}`]));
    for (let i = 0; i < n; i += Math.ceil(n / 12)) s += `<text x="${x(i)}" y="${h - 9}" text-anchor="middle">G${i + 1}</text>`;
  } else {
    title = `Average ${M.label} by season`; sub = 'Seasons with at least 2 matching games.';
    const avg = gs => { const by = {}; for (const g of gs) if (M.get(g) != null) (by[g.season] ||= []).push(M.get(g));
      return Object.entries(by).filter(([, v]) => v.length >= 2).map(([se, v]) => [+se, v.reduce((p, q) => p + q, 0) / v.length]); };
    const pa = avg(A), pb = avg(B), all = [...pa, ...pb].map(p => p[0]);
    if (!all.length) return `<h3>${title}</h3><p class="dim">Not enough games per season with these filters.</p>`;
    const lo = Math.min(...all), hi = Math.max(...all);
    const x = v => hi === lo ? w / 2 : m.l + (v - lo) / (hi - lo) * (w - m.l - m.r);
    series = [pa, pb].map(ps => ps.map(([se, v]) => [x(se), v, String(se)]));
    for (let yr = lo; yr <= hi; yr++) if (hi - lo < 12 || yr % 2 === 0) s += `<text x="${x(yr)}" y="${h - 9}" text-anchor="middle">${yr}</text>`;
  }
  series.forEach((pts, i) => {
    if (pts.length > 1) s += `<polyline points="${pts.map(p => `${p[0]},${y(p[1])}`).join(' ')}" fill="none" stroke="${CMP_COLORS[i]}" stroke-width="2.2" stroke-linejoin="round" opacity=".9"/>`;
    for (const p of pts) s += `<circle cx="${p[0]}" cy="${y(p[1])}" r="4" fill="${CMP_COLORS[i]}" stroke="#111821" stroke-width="2"><title>${p[2]}: ${f1(p[1])}</title></circle>`;
  });
  const c = state.cmp;
  return `<h3>${title}</h3><p>${sub}</p><div class="legend" style="margin-bottom:6px"><span><i class="ln" style="--c:${CMP_COLORS[0]}"></i>${esc(nameOf(c.a))}</span><span><i class="ln" style="--c:${CMP_COLORS[1]}"></i>${esc(nameOf(c.b))}</span></div>${s}</svg>`;
}

// ---------- Live game panel: click a game on the scoreboard
// ESPN's live box score + live passer rating + ESPN's live QBR + an estimated QER.
// Real QER needs EPA and CPOE, which arrive overnight, so during a game we estimate it
// from per-dropback rates with the model in data/live_model.json (qer/live_model.py).
let LIVE_MODEL = null, liveGameTimer = null;
function estimateQER(s) {
  const m = LIVE_MODEL, db = s.att + s.sacks;
  if (!m || db < m.min_dropbacks) return null;
  const f = { comp_pct: s.comp / s.att, ypa: s.yds / s.att, td_rate: s.td / db, int_rate: s.ints / db,
    sack_rate: s.sacks / db, sack_yds_db: s.sack_yds / db, rush_yds_db: s.rush_yds / db, rush_td_db: s.rush_td / db,
    margin: Math.max(-28, Math.min(28, s.pf - s.pa)), lead: s.pf > s.pa ? 1 : 0 };
  const v = m.intercept + Object.entries(m.coef).reduce((a, [k, c]) => a + c * f[k], 0);
  return Math.max(0, Math.min(100, v));
}
function espnCol(group, keyNames, labelNames) {
  // find a stat column by ESPN key, falling back to its label
  let i = (group.keys || []).findIndex(k => keyNames.includes(k));
  if (i < 0) i = (group.labels || []).findIndex(l => labelNames.includes(String(l).toUpperCase()));
  return i;
}
function parseQBs(summary) {
  const comp = summary.header?.competitions?.[0] || {};
  const score = {};
  for (const t of comp.competitors || []) score[ESPN_FIX[t.team.abbreviation] || t.team.abbreviation] = +t.score || 0;
  const out = [];
  for (const block of summary.boxscore?.players || []) {
    const team = ESPN_FIX[block.team.abbreviation] || block.team.abbreviation;
    const opp = Object.keys(score).find(t => t !== team);
    const pass = block.statistics.find(s => s.name === 'passing'), rush = block.statistics.find(s => s.name === 'rushing');
    if (!pass) continue;
    const ca = espnCol(pass, ['completions/passingAttempts'], ['C/ATT']), yd = espnCol(pass, ['passingYards'], ['YDS']);
    const td = espnCol(pass, ['passingTouchdowns'], ['TD']), it = espnCol(pass, ['interceptions'], ['INT']);
    const sk = espnCol(pass, ['sacks-sackYardsLost'], ['SACKS']), qb = espnCol(pass, ['adjQBR', 'QBR'], ['QBR']);
    for (const a of pass.athletes || []) {
      const st = a.stats || [];
      const [c, at] = String(st[ca] || '0/0').split('/').map(Number);
      if (!at) continue;
      const [sks, sky] = String(st[sk] || '0-0').split('-').map(Number);
      const r = rush?.athletes?.find(x => x.athlete?.id === a.athlete?.id);
      const rc = rush ? espnCol(rush, ['rushingAttempts'], ['CAR']) : -1, ry = rush ? espnCol(rush, ['rushingYards'], ['YDS']) : -1, rt = rush ? espnCol(rush, ['rushingTouchdowns'], ['TD']) : -1;
      const s = { name: a.athlete?.displayName || '?', photo: a.athlete?.headshot?.href, team, comp: c, att: at,
        yds: +st[yd] || 0, td: +st[td] || 0, ints: +st[it] || 0, sacks: sks || 0, sack_yds: sky || 0,
        rush_att: r ? +r.stats[rc] || 0 : 0, rush_yds: r ? +r.stats[ry] || 0 : 0, rush_td: r ? +r.stats[rt] || 0 : 0,
        qbr: qb >= 0 && st[qb] !== '--' ? +st[qb] : null, pf: score[team] || 0, pa: score[opp] || 0 };
      s.pr = passerRating(s.comp, s.att, s.yds, s.td, s.ints);
      s.est = estimateQER(s);
      out.push(s);
    }
  }
  return { qbs: out.sort((x, y) => y.att - x.att), status: comp.status?.type, score };
}
async function openLiveGame(id, away, home) {
  const modal = $('#live-modal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#live-body').innerHTML = `<p class="note">Loading ${away} @ ${home}…</p>`;
  clearTimeout(liveGameTimer);
  const load = async () => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`ESPN returned ${r.status}`);
      const { qbs, status, score } = parseQBs(await r.json());
      if (modal.hidden) return;
      const isLive = status?.state === 'in';
      const main = [away, home].map(t => qbs.find(q => q.team === t)).filter(Boolean);
      const others = qbs.filter(q => !main.includes(q));
      $('#live-title').innerHTML = `${away} ${score[away] ?? ''} <span class="dim">@</span> ${home} ${score[home] ?? ''} <span class="live-status ${isLive ? 'on' : ''}">${isLive ? '<span class="live-dot"></span>' : ''}${esc(status?.shortDetail || '')}</span>`;
      $('#live-body').innerHTML = !main.length ? '<p class="note">No passing stats yet. Check back after kickoff.</p>' : `
        <div class="live-grid">${main.map(q => {
          const id = Object.keys(PL).find(k => PL[k].name === q.name);
          const av = id ? avatar(id, q.team, 64) : `<span class="av" style="--s:64px;--tc:${teamColor(q.team)}"><b>${esc(initials(q.name))}</b>${q.photo ? `<img src="${esc(q.photo)}" alt="" onerror="this.remove()">` : ''}</span>`;
          return `<div class="panel live-qb" style="--tc:${teamColor(q.team)}">
            <div class="live-qb-head">${av}<div><b>${esc(q.name)}</b><span>${q.team} · ${q.comp}/${q.att}, ${q.yds} yds, ${q.td} TD, ${q.ints} INT, ${q.sacks} sk${q.rush_att ? ` · ${q.rush_att} rush, ${q.rush_yds} yds` : ''}</span></div></div>
            <div class="live-nums">
              <div><small>QER estimate</small><b class="num qer">${q.est == null ? '–' : f1(q.est)}</b><span>${q.est == null ? `needs ${LIVE_MODEL?.min_dropbacks ?? 10}+ dropbacks` : `± ${Math.round(LIVE_MODEL.mae)} typical`}</span></div>
              <div><small>Passer rating</small><b class="num">${f1(q.pr)}</b><span>of 158.3</span></div>
              <div><small>ESPN QBR</small><b class="num">${q.qbr == null ? '–' : f1(q.qbr)}</b><span>live</span></div>
            </div></div>`; }).join('')}</div>
        ${others.length ? `<p class="note">Also threw: ${others.map(q => `${esc(q.name)} (${q.team}) ${q.comp}/${q.att}, ${q.yds} yds`).join(' · ')}</p>` : ''}
        <p class="note">The QER estimate comes from the live box score (completion %, yards per attempt, TD/INT/sack rates, rushing, score) using a model fitted on ${LIVE_MODEL?.n_games?.toLocaleString() ?? 'every'} starts since 2006. The official QER, built from play-by-play EPA and CPOE, posts the morning after the game.${isLive ? ' Updates every 30 seconds.' : ''}</p>`;
      if (isLive) liveGameTimer = setTimeout(load, 30000);
    } catch (e) {
      $('#live-body').innerHTML = `<p class="note">Couldn't reach ESPN's live feed (${esc(e.message)}). Try again in a moment.</p>`;
    }
  };
  $('#live-title').textContent = `${away} @ ${home}`;
  load();
}
function closeLiveGame() {
  $('#live-modal').hidden = true; document.body.style.overflow = ''; clearTimeout(liveGameTimer);
}

// ---------- shell: views, season switching, routing
const VIEWS = ['rankings', 'week', 'matchups', 'qb', 'compare', 'method'];
function render() {
  const i = WEEKS.indexOf(state.week);
  refreshInjuries();
  $('#wk-lbl').innerHTML = state.view === 'week' ? `${weekName(state.week)}<small>games of</small>` : `${weekName(state.week)}<small>through</small>`;
  $('#wk-prev').disabled = i <= 0; $('#wk-next').disabled = i >= WEEKS.length - 1;
  $('#season-select').value = state.season;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === state.view));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + state.view);
  $('.stepper').style.visibility = state.view === 'compare' || state.view === 'method' ? 'hidden' : 'visible';
  ({ rankings: renderRankings, week: renderWeek, matchups: renderMatchups, qb: renderQB, compare: renderCompare, method: renderMethod })[state.view]();
}
function go(view, qb) {
  state.view = VIEWS.includes(view) ? view : 'rankings'; if (qb) state.qb = qb;
  try { localStorage.setItem('qer.view', state.view); } catch (e) {}
  try { history.replaceState(null, '', '#' + state.view); } catch (e) {}
  render(); window.scrollTo({ top: 0 });
}
async function setSeason(season, week) {
  $('#loading').hidden = false;
  try {
    useSeason(await loadSeason(season));
    state.season = season;
    state.week = week && WEEKS.includes(week) ? week : S.default_week;
    state.mweek = null;
    if (typeof state.sm === 'number') state.sm = 'season';
    render();
  } catch (e) {
    $('#view-' + state.view).innerHTML = `<div class="panel empty"><h3>Couldn't load ${season}</h3><p>${esc(e.message)}. Check that site/data was built with <code>python -m qer.export</code>.</p></div>`;
  } finally { $('#loading').hidden = true; }
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });
$('#wk-prev').addEventListener('click', () => { state.week = WEEKS[Math.max(0, WEEKS.indexOf(state.week) - 1)]; render(); });
$('#wk-next').addEventListener('click', () => { state.week = WEEKS[Math.min(WEEKS.length - 1, WEEKS.indexOf(state.week) + 1)]; render(); });
$('#season-select').addEventListener('change', e => setSeason(+e.target.value));
document.querySelector('main').addEventListener('click', e => {
  const sg = e.target.closest('[data-season-go]'); if (sg) { setSeason(+sg.dataset.seasonGo); return; }
  const cp = e.target.closest('[data-compare]'); if (cp) { state.cmp.a = cp.dataset.compare; state.cmp.opp = ''; go('compare'); return; }
  const qc = e.target.closest('[data-qb-career]'); if (qc) { const id = qc.dataset.qbCareer; const last = Math.max(...PL[id].seasons);
    setSeason(last).then(() => go('qb', id)); return; }
  const mw = e.target.closest('[data-mweek]'); if (mw) { if (mw.dataset.mweek) { state.mweek = +mw.dataset.mweek; renderMatchups(); } return; }
  const rb = e.target.closest('[data-rby]'), rm = e.target.closest('[data-rmetric]'), rmin = e.target.closest('[data-rmin]'), rinj = e.target.closest('[data-rinj]');
  if (rb || rm || rmin || rinj) {
    if (rb && !rb.disabled) state.rby = rb.dataset.rby;
    if (rm) { state.rmetric = rm.dataset.rmetric; if (state.rmetric !== 'qer' && state.rby === 'power') state.rby = 'season'; }
    if (rmin) state.rf.minGames = +rmin.dataset.rmin;
    if (rinj) state.rf.hideInjured = !state.rf.hideInjured;
    try { localStorage.setItem('qer.rank', JSON.stringify({ rby: state.rby, rmetric: state.rmetric, rf: state.rf })); } catch (e) {}
    renderRankings(); return;
  }
  const cm = e.target.closest('[data-cmetric]'); if (cm) { state.cmp.metric = cm.dataset.cmetric; renderCompare(); return; }
  const xm = e.target.closest('[data-xm]'); if (xm) { state.xm = xm.dataset.xm; renderWeek(); return; }
  const wb = e.target.closest('[data-wk]'); if (wb) { state.week = +wb.dataset.wk; render(); return; }
  const q = e.target.closest('[data-qb]'); if (q && state.view !== 'qb') go('qb', q.dataset.qb);
});
document.querySelector('main').addEventListener('change', e => {
  if (e.target.matches('[data-sw]')) { const v = e.target.value; state.sm = /^\d+$/.test(v) ? +v : v; renderWeek(); }
});
document.querySelector('main').addEventListener('keydown', e => { if (e.key === 'Enter') { const q = e.target.closest('[data-qb]'); if (q) go('qb', q.dataset.qb); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
const openFromStrip = e => { const g = e.target.closest('[data-live-game]'); if (g) openLiveGame(g.dataset.liveGame, g.dataset.away, g.dataset.home); };
$('#scores').addEventListener('click', openFromStrip);
$('#scores').addEventListener('keydown', e => { if (e.key === 'Enter') openFromStrip(e); });
$('#live-modal').addEventListener('click', e => { if (e.target.id === 'live-modal' || e.target.closest('#live-close')) closeLiveGame(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#live-modal').hidden) closeLiveGame(); });

// ---------- start
(async function boot() {
  try {
    [MANIFEST, PL] = await Promise.all([getJSON('data/manifest.json'), getJSON('data/players.json')]);
    LIVE_MODEL = await getJSON('data/live_model.json').catch(() => null);
    TEAM = Object.fromEntries((await getJSON('data/teams.json')).map(t => [t.team_abbr, t]));
    TEAM.LA ||= TEAM.LAR; TEAM.LAR ||= TEAM.LA;
  } catch (e) {
    $('main').innerHTML = `<div class="panel empty"><h3>No data yet</h3><p>${esc(e.message)}. Build it with <code>python -m qer.pipeline run</code> then <code>python -m qer.export</code>, and serve the site folder (for example <code>python -m http.server -d site</code>).</p></div>`;
    return;
  }
  const seasons = MANIFEST.seasons.map(s => s.season).sort((a, b) => b - a);
  $('#season-select').innerHTML = seasons.map(s => `<option value="${s}">${s}</option>`).join('');
  $('#foot').innerHTML = `Data: nflverse play-by-play, schedules, injury reports and ESPN QBR · QER v${esc(MANIFEST.qer_version)} · updated ${esc(MANIFEST.generated.replace('T', ' '))} UTC · Player photos from NFL.com and ESPN.`;
  const fromHash = location.hash.slice(1);
  if (VIEWS.includes(fromHash)) state.view = fromHash;
  CURRENT = await loadSeason(MANIFEST.current_season);
  await setSeason(MANIFEST.current_season);
  pollLive();
})();
})();
