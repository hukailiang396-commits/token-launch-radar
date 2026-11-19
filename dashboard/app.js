// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view with the model's
// own terms and the protocol's farm plan, and the live-token section kept apart from the
// launch board. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;
  var WATCH = {};
  DATA.watchlist.forEach(function (s) { WATCH[s] = true; });

  // Rows arrive as compact arrays; name each position once, here.
  function rowOf(a) {
    return {
      rank: a[0], slug: a[1], name: a[2], category: a[3], chains: a[4], tvl: a[5],
      change: a[6], listed: a[7], age: a[8], implied: a[9], base: a[10],
      growthMult: a[11], patienceMult: a[12], watch: !!WATCH[a[1]],
    };
  }
  var ROWS = DATA.rows.map(rowOf);
  var LIVE = DATA.live.map(function (a) {
    return { slug: a[0], name: a[1], category: a[2], chains: a[3], tvl: a[4], mcap: a[5], change: a[6] };
  });

  var state = { q: '', category: 'all', chain: 'all', tab: 'all', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed here from the snapshot figures the program wrote: the page checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. See lib/model.ts for the same formula with its reasons.
  function valueParts(r) {
    var base = MODEL.base_scale * Math.pow(Math.max(r.tvl, 1) / 1e6, MODEL.base_exponent);
    var g = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, r.change === null || r.change === undefined ? 0 : r.change));
    var gm = 1 + g * MODEL.growth_weight;
    var age = r.age === null || r.age === undefined ? MODEL.unknown_age_days : r.age;
    var pm = MODEL.patience_floor + (Math.min(Math.max(age, 0), MODEL.patience_days) / MODEL.patience_days) * MODEL.patience_range;
    return { base: Math.round(base), growthPct: g, growthMult: gm, patienceMult: pm, implied: Math.max(1, Math.round(base * gm * pm)) };
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // band and age decide the action, the capital, the hold and every cost and time. No name
  // is special-cased, so two protocols in different families never get the same plan.
  function chainOf(r) { return r.chains && r.chains.length > 0 ? r.chains[0] : 'its main chain'; }
  function secondChainOf(r) { return r.chains && r.chains.length > 1 ? r.chains[1] : null; }
  function capitalFor(r) {
    if (r.tvl >= 1e9) return 250;
    if (r.tvl >= 1e8) return 150;
    if (r.tvl >= 25e6) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function familyOf(r) {
    var c = (r.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lend';
    if (c.indexOf('dex') >= 0) return 'dex';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('leveraged') >= 0 || c.indexOf('interest rate') >= 0) return 'deriv';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'vault';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'pay';
    if (c.indexOf('insurance') >= 0) return 'cover';
    if (c.indexOf('prediction') >= 0) return 'predict';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('liquidity manager') >= 0) return 'yield';
    return 'deposit';
  }
  function primaryAction(r, capital, chain) {
    var name = r.name;
    switch (familyOf(r)) {
      case 'lend': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 of USDC against it so the position shows both sides.';
      case 'dex': return 'Provide $' + capital + ' of liquidity to ' + name + "'s largest pool on " + chain + ' \u2014 USDC against the chain' + "'s native asset \u2014 and keep the LP receipt.";
      case 'deriv': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, no more than $25 of notional.';
      case 'vault': return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the same wallet.';
      case 'rwa': return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
      case 'pay': return 'Move $' + capital + ' of USDC through ' + name + ' on ' + chain + ' and leave a $25 balance in its app for the next month.';
      case 'cover': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a protocol you already use, and keep the policy active.';
      case 'predict': return 'Fund $' + capital + ' on ' + name + ' on ' + chain + ' and place one small position on a market that settles within 30 days.';
      case 'stable': return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it instead of swapping it away.';
      case 'yield': return 'Deposit $' + capital + ' of USDC into ' + name + "'s main yield position on " + chain + ' and leave the rewards unclaimed until week four.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open in the farming wallet.';
    }
  }
  function secondAction(r, capital, chain) {
    var name = r.name;
    var second = secondChainOf(r);
    switch (familyOf(r)) {
      case 'lend': return 'After a week, repay half the $20 borrow on ' + name + ' on ' + chain + (second ? ' and open the same supply-and-borrow pair on ' + second : ' and re-supply the repaid funds') + '.';
      case 'dex': return "Swap $25 of USDC for the pool's other asset on " + name + ' on ' + chain + (second ? ', then add $25 of liquidity on ' + second : ' and add it to the same pool') + '.';
      case 'deriv': return 'Close the hedge on ' + name + ' on ' + chain + ' after seven days' + (second ? ', then open one small hedge on ' + second : ' and open a fresh one half the size') + '.';
      case 'vault': return 'Add $25 more to the ' + name + ' vault on ' + chain + ' after two weeks' + (second ? ', then deposit $25 into its vault on ' + second : ' so the vault sees a second deposit') + '.';
      case 'rwa': return 'After a month, redeem $25 of the ' + name + ' asset on ' + chain + (second ? ' and mint $25 of it on ' + second : ' and mint it back the same day') + '.';
      case 'yield': return 'Compound the first rewards back into ' + name + ' on ' + chain + ' in week four' + (second ? ', then deposit $25 on ' + second : ' instead of withdrawing them') + '.';
      default: return 'Make a second, smaller deposit of $25 into ' + name + ' on ' + chain + ' after two weeks' + (second ? ' and the same on ' + second : ' so the protocol sees repeat activity') + '.';
    }
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(r) {
    var chain = chainOf(r);
    var capital = capitalFor(r);
    var hold = holdDaysFor(r.age);
    var gas = capital >= 250 ? 8 : capital >= 150 ? 6 : 4;
    return [
      { text: 'Set up a fresh wallet for ' + r.name + ' only, fund it with $' + (capital + 15) + ' of USDC on ' + chain + ', and keep its seed phrase offline.', cost: 'about $3 of gas for the first transfer', time: '5 minutes' },
      { text: primaryAction(r, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(r, capital, chain), cost: 'about $3 of gas, plus the $25 second leg', time: '10 minutes' },
      { text: 'Do one qualifying action on ' + r.name + ' every week \u2014 a deposit, a swap, a borrow or a vote \u2014 and keep the same wallet for all of them.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity spans more than one snapshot, then open ' + r.name + "'s own points or rewards page and claim only from the link it publishes.", cost: 'the $' + capital + ' stays in the position; never pay to claim', time: hold + ' days, then 10 minutes' },
      { text: 'Log the wallet, the dates and every transaction for ' + r.name + ' on ' + chain + ', then unwind in two halves a week apart instead of exiting at once.', cost: 'nothing but the log', time: '5 minutes to log' },
    ].map(stepText);
  }

  // ---- filtering and sorting ----
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (state.tab === 'watchlist' && !r.watch) return false;
      if (state.tab === 'early' && r.watch) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    list.sort(function (a, b) {
      var d = 0;
      if (key === 'rank' || key === 'implied') d = a.implied - b.implied;
      else if (key === 'tvl') d = a.tvl - b.tvl;
      else if (key === 'change') d = (a.change === null ? -1e9 : a.change) - (b.change === null ? -1e9 : b.change);
      else if (key === 'age') d = (a.age === null ? -1 : a.age) - (b.age === null ? -1 : b.age);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
    return list;
  }

  // ---- rendering ----
  var app = document.getElementById('board');
  var maxImplied = ROWS[0] ? ROWS[0].implied : 1;

  function categories() {
    var seen = {};
    ROWS.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    ROWS.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function sortButton(key, label) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' \u25bc' : ' \u25b2') : '';
    return '<button data-sort="' + key + '">' + label + arrow + '</button>';
  }

  function rowHtml(r) {
    var pct = r.change === null ? 'n/a' : fmtPct(r.change);
    var cls = r.change === null ? '' : (r.change >= 0 ? 'pos' : 'neg');
    var badge = r.watch ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY FIND</span>';
    var width = Math.max(2, Math.round((r.implied / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.slug) + '</span></span>' + badge + '</td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="sub">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
      '<td class="num ' + cls + '">' + pct + '</td>' +
      '<td class="num">' + fmtAge(r.age) + '</td>' +
      '<td><span class="implied"><span class="bar"><i style="width:' + width + '%"></i></span><span class="num">' + fmtUsd(r.implied) + '</span></span></td>' +
      '</tr>';
  }

  function detailHtml(r) {
    var v = valueParts(r);
    var steps = farmSteps(r);
    var check = v.implied === r.implied
      ? 'The page recomputes ' + fmtUsd(v.implied) + ' from the same figures — it matches the board.'
      : 'The page recomputes ' + fmtUsd(v.implied) + '; the board carries ' + fmtUsd(r.implied) + ' after a $1 tie-break step.';
    var stepsHtml = steps.map(function (s, i) {
      var cut = s.lastIndexOf(' Cost: ');
      var body = cut > 0 ? s.slice(0, cut) : s;
      var tail = cut > 0 ? s.slice(cut + 1) : '';
      return '<li><p>' + esc(body) + '</p><p class="cost">' + esc(tail) + '</p></li>';
    }).join('');
    return '<div class="detail-head"><div><span class="kicker">Rank #' + r.rank + (r.watch ? ' · Watchlist' : ' · Early find') + '</span>' +
      '<h2>' + esc(r.name) + '</h2><p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ')) + '</p></div>' +
      '<button class="close" data-close="1">Close</button></div>' +
      '<div class="section"><h3>Snapshot figures</h3><div class="kv">' +
      '<div><span>TVL</span><b class="num">' + fmtUsd(r.tvl) + '</b></div>' +
      '<div><span>7-day TVL change</span><b class="num ' + (r.change !== null && r.change >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change) + '</b></div>' +
      '<div><span>Tracked since</span><b class="num">' + (r.listed || 'unknown') + ' (' + fmtAge(r.age) + ')</b></div>' +
      '<div><span>Token</span><b>records no token</b></div></div>' +
      '<p class="note">“Records no token” is what the snapshot says — DefiLlama\u2019s record is not proof the protocol has none.</p></div>' +
      '<div class="section"><h3>Why it ranks here — the value model</h3><div class="equation">' +
      '<div><span>Base — log scale of TVL</span><b class="num">' + fmtUsd(v.base) + '</b></div>' +
      '<div><span>Growth — ' + fmtPct(v.growthPct) + ' over 7 days</span><b class="num">\u00d7 ' + v.growthMult.toFixed(3) + '</b></div>' +
      '<div><span>Patience — ' + fmtAge(r.age) + ' with no token recorded</span><b class="num">\u00d7 ' + v.patienceMult.toFixed(3) + '</b></div>' +
      '<div class="total"><span>Implied value</span><b class="num">' + fmtUsd(r.implied) + '</b></div></div>' +
      '<p class="note">' + esc(check) + '</p></div>' +
      '<div class="section"><h3>Farm plan — 6 steps</h3><ol class="steps">' + stepsHtml + '</ol>' +
      '<p class="note">Costs are gas plus the capital at risk; nothing here is a promise of a token or an airdrop.</p></div>';
  }

  function render() {
    var list = filtered();
    var sel = state.selected ? ROWS.filter(function (r) { return r.slug === state.selected; })[0] : null;
    var top = ROWS[0];
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chs = chains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var liveRows = LIVE.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b> <span class="sub">' + esc(p.slug) + '</span></td><td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl) + '</td><td class="num">' + fmtUsd(p.mcap) + '</td>' +
        '<td class="num ' + (p.change !== null && p.change >= 0 ? 'pos' : 'neg') + '">' + fmtPct(p.change) + '</td></tr>';
    }).join('');
    app.innerHTML =
      '<div class="shell">' +
      '<header class="top"><div><p class="kicker">Token Launch Radar · snapshot ' + esc(DATA.as_of) + '</p>' +
      '<h1>Which protocol\u2019s token would be <em>worth most</em> if it launched?</h1>' +
      '<p class="lede">Every protocol below <b>records no token</b> in the snapshot. Each is ranked by an implied value built only from its own figures — TVL on a log scale, its 7-day growth, and how long it has run with no token — with a concrete farm plan for each one. Protocols whose token already trades are listed apart, at their recorded market cap.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>ranked protocols</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>early finds</span></div>' +
      '<div class="stat"><b>' + fmtUsd(top ? top.implied : 0) + '</b><span>top implied value</span></div>' +
      '</div></header>' +
      '<section class="model"><h3>How the implied value is built — ' + esc(DATA.model_version) + '</h3>' +
      '<p class="formula">base = $1,000,000 \u00d7 (TVL / $1,000,000)<span>^ 0.70</span> &nbsp;·&nbsp; growth = 1 + clamp(7d change, \u221240%, +80%) \u00d7 <span>0.0075</span> &nbsp;·&nbsp; patience = 0.75 + 0.45 \u00d7 min(age, 4y) / 4y<br>implied = round(base \u00d7 growth \u00d7 patience). Log scale, so the board is not a TVL table; growth is clamped, so one hot week cannot crown a protocol; patience is capped, so age alone cannot dominate.</p>' +
      '<p>No protocol name is special-cased. Exchanges, bridges and wrapped or staked products are not launch candidates and never enter the board.</p></section>' +
      '<div class="controls">' +
      '<div class="field"><label for="q">Search name or slug</label><input id="q" type="search" placeholder="e.g. gauntlet" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat"><option value="all">All categories</option>' + cats + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain"><option value="all">All chains</option>' + chs + '</select></div>' +
      '<div class="tabs" role="group" aria-label="Board scope">' +
      '<button data-tab="all" aria-pressed="' + (state.tab === 'all') + '">All ' + DATA.board_size + '</button>' +
      '<button data-tab="watchlist" aria-pressed="' + (state.tab === 'watchlist') + '">Watchlist</button>' +
      '<button data-tab="early" aria-pressed="' + (state.tab === 'early') + '">Early finds</button>' +
      '</div>' +
      '<span class="count">' + list.length + ' of ' + ROWS.length + ' shown · sorted by ' + state.sort + '</span>' +
      '</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr>' +
      '<th>' + sortButton('rank', 'Rank') + '</th><th>' + sortButton('name', 'Protocol') + '</th><th>Category</th><th>Chains</th>' +
      '<th>' + sortButton('tvl', 'TVL') + '</th><th>' + sortButton('change', '7d') + '</th><th>' + sortButton('age', 'Age') + '</th><th>' + sortButton('implied', 'Implied value') + '</th>' +
      '</tr></thead><tbody>' + (list.length ? list.map(rowHtml).join('') : '') + '</tbody></table>' +
      (list.length ? '' : '<div class="empty"><h2>Nothing matches those filters</h2><p>Clear the search or pick another category.</p><button class="button" data-clear="1">Clear filters</button></div>') +
      '</div></div>' +
      '<section class="live panel" style="margin-top:22px;padding:18px"><h2>Already trading — not launch candidates</h2>' +
      '<p>The 24 largest protocols by recorded market cap whose token already trades. They are ranked here by market cap, never mixed into the launch board above.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>7d</th></tr></thead><tbody>' + liveRows + '</tbody></table></div></section>' +
      '<footer class="foot"><span>Snapshot: ' + esc(DATA.source) + ' · as of ' + esc(DATA.as_of) + ' · floor $' + fmtUsd(DATA.floor_usd).replace('$', '') + ' · data digest ' + esc(DATA.digest) + '</span>' +
      '<span>Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token will launch or what it will trade at.</span></footer>' +
      '</div>' +
      '<aside class="detail" id="detail" ' + (sel ? '' : 'hidden') + '>' + (sel ? detailHtml(sel) : '') + '</aside>';

    app.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
    writeHash();
  }

  // ---- state in the URL hash, so a view can be linked and screenshotted ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'all') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  app.addEventListener('input', function (e) {
    if (e.target.id === 'q') { state.q = e.target.value; render(); }
  });
  app.addEventListener('change', function (e) {
    if (e.target.id === 'cat') { state.category = e.target.value; render(); }
    if (e.target.id === 'chain') { state.chain = e.target.value; render(); }
  });
  app.addEventListener('click', function (e) {
    var t = e.target;
    var sortBtn = t.closest ? t.closest('[data-sort]') : null;
    if (sortBtn) {
      var key = sortBtn.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
      return;
    }
    var tabBtn = t.closest ? t.closest('[data-tab]') : null;
    if (tabBtn) { state.tab = tabBtn.getAttribute('data-tab'); render(); return; }
    if (t.closest && t.closest('[data-clear]')) {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'all'; render(); return;
    }
    if (t.closest && t.closest('[data-close]')) { state.selected = null; render(); return; }
    var row = t.closest ? t.closest('tbody tr[data-slug]') : null;
    if (row) { state.selected = row.getAttribute('data-slug'); render(); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
  });

  readHash();
  render();
})();
