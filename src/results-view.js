export function resultsView(state,myId,frame,{e,avatar,icon}) {
  const {entries,complete,winners}=frame;
  const title=complete ? winners.length>1 ? 'Разделили победу!' : `${e(winners[0].player.name)} побеждает!` : 'Итоги партии';
  return `<main class="results reveal-results ${complete?'reveal-complete':''}">
    <div class="results-heading" aria-live="polite"><span class="results-emblem">${complete?icon('cup'):icon('cards')}</span><h1>${title}</h1><p>${complete?'Каждый кубик на своём месте.':'Открываем результаты…'}</p></div>
    <section class="ranking-row" aria-label="Итоги партии, от первого места к последнему">${entries.map(({player:p,points,place,elapsed,front,open,flipping})=>`<article data-player="${p.id}" class="result-reveal-card ${open?'is-open':''} ${flipping?'is-flipping':''} ${place===1?'rank-first':''}" style="--result-delay:${-Math.max(0,elapsed)}ms" aria-label="${front?`${place} место, ${e(p.name)}, ${points} очков`:'Результат ещё не открыт'}">
      <div class="result-flip-inner"><div class="result-back" aria-hidden="true"><div class="sealed-mark">${icon('dice')}</div><span>КОСТИ<br>КРОКОДИЛА</span><i>✦</i></div>
      <div class="result-front" aria-hidden="${!front}"><span class="ranking-place">${place===1?icon('cup'):String(place).padStart(2,'0')}</span><button class="result-avatar-button reaction-anchor" ${p.id===myId?'data-action="emotions"':'data-inspect="'+p.id+'"'} aria-label="${e(p.name)}${p.id===myId?', открыть эмоции':', посмотреть коллекцию'}" ${!open?'disabled tabindex="-1"':''}><img src="${avatar(p.avatar)}" alt=""/></button><h2>${e(p.name)}${p.id===myId?' <small>вы</small>':''}</h2><strong>${points}<span>очков</span></strong><div class="ranking-collection">${icon('dice')} ${p.dice.length} ${icon('cards')} ${p.cards.length}</div><button class="result-collection-button" data-inspect="${p.id}" ${!open?'disabled tabindex="-1"':''}>Рассмотреть коллекцию</button></div></div>
    </article>`).join('')}</section>
    <div class="result-controls ${complete?'is-visible':''}" ${!complete?'inert aria-hidden="true"':''}>${myId===state.hostId?'<button class="button primary" data-action="rematch">Ещё одну партию? '+icon('arrow')+'</button>':'<span class="waiting-chip">Создатель может начать новую партию</span>'}<button class="button secondary" data-action="log">Посмотреть ход партии</button></div>
  </main>`;
}
