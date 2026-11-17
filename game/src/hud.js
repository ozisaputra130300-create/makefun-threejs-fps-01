// Duskline Depot HUD: health, armour, ammo, money, timer, score, alive
// count, site tag, kill feed, spike progress, banners, the start/pause/buy
// overlays and the buy menu. All DOM, no canvas text, so screenshots show
// the same HUD a player sees.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-value'),
    healthFill: $('health-fill'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weapon: $('weapon-name'),
    money: $('money-value'),
    timer: $('timer-value'),
    score: $('score-value'),
    alive: $('alive-value'),
    site: $('site-tag'),
    feed: $('killfeed'),
    spike: $('spike'),
    spikeLabel: $('spike-label'),
    spikeFill: $('spike-fill'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    vignette: $('damage-vignette'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buyMenu: $('buy-menu'),
    buyMoney: $('buy-money'),
    buyList: $('buy-list'),
  };
  let bannerTimer = 0;
  let hitTimer = 0;

  const OVERLAYS = {
    start: ['Duskline Depot', 'One striker against five depot guards in the rail yard at dusk. Plant the charge at the Crane Yard or the Warehouse — or drop every guard. First to 6 rounds takes the depot.'],
    paused: ['Paused', 'Click to play — the round is waiting.'],
    buy: ['Buy phase', 'Spend the round’s money. B opens the market.'],
    roundWin: ['Round won', ''],
    roundLoss: ['Round lost', ''],
    matchWin: ['Depot taken', ''],
    matchLoss: ['Depot held', ''],
  };

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      els.health.textContent = String(v);
      els.healthFill.style.width = `${v}%`;
      els.healthFill.classList.toggle('low', v <= 30);
    },
    setArmor(a) {
      els.armor.textContent = a > 0 ? `ARM ${Math.round(a)}` : 'ARM —';
    },
    setAmmo(mag, reserve) {
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      els.weapon.textContent = name;
    },
    setMoney(m) {
      els.money.textContent = `$${Math.round(m)}`;
    },
    setTimer(seconds) {
      els.timer.textContent = fmtTime(seconds);
      els.timer.classList.toggle('urgent', seconds <= 10);
    },
    setScore(you, foes) {
      els.score.textContent = `${you} — ${foes}`;
    },
    setAlive(you, foes) {
      els.alive.textContent = `${you} v ${foes}`;
    },
    setSite(text) {
      els.site.textContent = text;
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--spread', `${Math.round(px)}px`);
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      els.feed.prepend(line);
      while (els.feed.children.length > 4) els.feed.lastChild.remove();
      window.setTimeout(() => line.remove(), 6000);
    },
    hitMarker(killed, holdMs) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => els.hitmarker.classList.remove('on'), holdMs ?? 180);
    },
    damageFlash() {
      els.vignette.classList.add('on');
      window.setTimeout(() => els.vignette.classList.remove('on'), 220);
    },
    setSpike(kind, frac) {
      if (!kind) {
        els.spike.hidden = true;
        return;
      }
      els.spike.hidden = false;
      els.spikeLabel.textContent = kind === 'planting' ? 'PLANTING CHARGE'
        : kind === 'planted' ? 'CHARGE ARMED — DEFEND IT'
        : 'GUARD DEFUSING — STOP THEM';
      els.spikeFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
      els.spikeFill.classList.toggle('danger', kind === 'defusing');
    },
    banner(title, sub) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub ?? '';
      els.banner.classList.add('on');
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => els.banner.classList.remove('on'), 2400);
    },
    showOverlay(kind, detail) {
      const [title, copy] = OVERLAYS[kind] ?? OVERLAYS.start;
      els.overlayTitle.textContent = title;
      els.overlayCopy.textContent = detail === undefined ? copy : String(detail);
      els.overlay.hidden = false;
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    showBuy(items, money) {
      els.buyMoney.textContent = `$${Math.round(money)}`;
      els.buyList.replaceChildren();
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.disabled;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name"></span><span class="buy-price">$${item.price}</span>`;
        row.querySelector('.buy-name').textContent = item.name + (item.owned ? ' — owned' : '');
        row.addEventListener('click', () => item.onBuy(item.id));
        els.buyList.appendChild(row);
      }
      els.buyMenu.hidden = false;
    },
    hideBuy() {
      els.buyMenu.hidden = true;
    },
    onPlay(fn) {
      els.play.addEventListener('click', fn);
    },
    onBuy(fn) {
      // Buy rows call back through showBuy's item.onBuy; this wires the
      // keyboard path the game drives.
      this._buyFn = fn;
    },
    buyViaKey(id) {
      if (this._buyFn) this._buyFn(id);
    },
  };
}
