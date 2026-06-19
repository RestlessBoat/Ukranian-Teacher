// Основная логика приложения: состояние, дневной цикл, экраны, квизы, геймификация.
(function () {
  "use strict";

  // ---------- Константы геймификации ----------
  const XP_PER_NEW_WORD = 10;
  const XP_PER_QUIZ_WORD = 5;
  const NEW_WORDS_PER_DAY = 3;
  const DAILY_QUIZ_SIZE = 10;
  const MAX_LEVEL = 100;
  const QUIZ_QUESTIONS_PER_WORD = 3;

  function xpNeededForLevel(l) { return 30 + (l - 1) * 10; }

  const LEAGUES = [
    { min: 100, emoji: "👑", name: "Мастер" },
    { min: 75,  emoji: "💎", name: "Бриллиант" },
    { min: 50,  emoji: "🥇", name: "Золото" },
    { min: 25,  emoji: "🥈", name: "Серебро" },
    { min: 10,  emoji: "🥉", name: "Бронза" },
    { min: 1,   emoji: "🌱", name: "Новичок" }
  ];
  function leagueForLevel(level) {
    return LEAGUES.find((l) => level >= l.min) || LEAGUES[LEAGUES.length - 1];
  }

  const POS_RU = {
    "вигук": "междометие", "іменник": "существительное",
    "дієслово": "глагол",  "прикметник": "прилагательное",
    "прислівник": "наречие", "частка": "частица"
  };
  function posLabel(pos) { return POS_RU[pos] || pos; }

  const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь",
                     "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

  // ---------- Состояние ----------
  const WORDS = window.WORDS || [];
  const WORDS_BY_ID = Object.fromEntries(WORDS.map((w) => [w.id, w]));
  let progress = window.Storage.load();
  const app = document.getElementById("app");

  // Флаги режимов
  let isExtraLearning = false; // учим слова сверх дневной нормы
  let practiceMode = false;    // необязательная практика без XP/штрафов
  let pendingLevelUp = null;   // { prevLevel, newLevel } — ожидает показа оверлея

  // ---------- Утилиты ----------
  function save() { window.Storage.save(progress); }
  function today() { return window.Storage.today(); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Звук и тактильность ----------
  function playSound(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      if (type === "correct") {
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(180, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
      }
    } catch (e) {}
  }

  function vibrate(type) {
    if (!navigator.vibrate) return;
    navigator.vibrate(type === "correct" ? [40] : [80, 60, 40]);
  }

  // ---------- XP тост (всплывающий "+N XP") ----------
  function showXpToast(amount) {
    const toast = document.createElement("div");
    toast.className = "xp-toast";
    toast.textContent = "+" + amount + " XP";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1050);
  }

  // ---------- Оверлей повышения уровня ----------
  function showLevelUp(prevLevel, newLevel, callback) {
    const league = leagueForLevel(newLevel);
    const overlay = document.createElement("div");
    overlay.className = "level-overlay";
    const medal = document.createElement("div");
    medal.className = "level-medal-big";
    medal.textContent = league.emoji;
    const txt = document.createElement("div");
    txt.className = "level-text-big";
    txt.textContent = "Уровень " + newLevel + "!";
    const sub = document.createElement("div");
    sub.className = "level-sub";
    sub.textContent = league.name;
    overlay.appendChild(medal); overlay.appendChild(txt); overlay.appendChild(sub);
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.style.animation = "levelOut 0.35s ease forwards";
      setTimeout(() => { overlay.remove(); callback(); }, 380);
    }, 1900);
  }

  // ---------- Озвучка ----------
  let ukVoice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    ukVoice = voices.find((v) => /uk(-|_)?/i.test(v.lang)) ||
              voices.find((v) => /ukrain/i.test(v.name)) || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const cleaned = text.replace(/^\s*[-–—]\s*/, "").trim();
      const u = new SpeechSynthesisUtterance(cleaned);
      u.lang = "uk-UA";
      if (ukVoice) u.voice = ukVoice;
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- Геймификация ----------
  function addXp(amount) {
    showXpToast(amount);
    const prevLevel = progress.level;
    progress.xp += amount;
    while (progress.level < MAX_LEVEL && progress.xp >= xpNeededForLevel(progress.level)) {
      progress.xp -= xpNeededForLevel(progress.level);
      progress.level += 1;
    }
    if (progress.level >= MAX_LEVEL) progress.level = MAX_LEVEL;
    if (progress.level > prevLevel) {
      pendingLevelUp = { prevLevel, newLevel: progress.level };
    }
  }

  // ---------- Streak ----------
  function bumpStreak() {
    const t = today();
    if (progress.lastActiveDate === t) return;
    const yesterday = (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    })();
    if (progress.lastActiveDate === yesterday) progress.dayStreak += 1;
    else progress.dayStreak = 1;
    progress.lastActiveDate = t;
  }

  // ---------- Лог активности для календаря ----------
  function logActivity(type) {
    const t = today();
    if (!progress.activityLog) progress.activityLog = {};
    if (!progress.activityLog[t]) progress.activityLog[t] = {};
    progress.activityLog[t][type] = true;
  }

  // ---------- Выбор слов ----------
  function learnedWords() {
    return progress.learnedWordIds.map((id) => WORDS_BY_ID[id]).filter(Boolean);
  }

  function pickNewWords(count) {
    const result = [];
    const forgotten = WORDS.filter(
      (w) => progress.wordStates[w.id] && progress.wordStates[w.id].status === "forgotten"
    );
    for (const w of forgotten) { if (result.length >= count) break; result.push(w); }
    let idx = progress.newWordIndex;
    while (result.length < count && idx < WORDS.length) {
      const w = WORDS[idx];
      const st = progress.wordStates[w.id];
      if (!st || (st.status !== "learned" && st.status !== "forgotten")) result.push(w);
      idx++;
    }
    return result;
  }

  function remainingNewWords() {
    return WORDS.filter((w) => {
      const st = progress.wordStates[w.id];
      return !st || st.status !== "learned";
    }).length;
  }

  function translationOptions(word, key) {
    const correct = word[key];
    const pool = shuffle(WORDS.filter((w) => w.id !== word.id && w[key] !== correct));
    return shuffle([correct, ...pool.slice(0, 3).map((w) => w[key])]);
  }

  function dayState() {
    const t = today();
    const hasLearned = learnedWords().length > 0;
    const quizDue = hasLearned && progress.lastDailyQuizDate !== t;
    const newDue = progress.lastNewWordsDate !== t && pickNewWords(NEW_WORDS_PER_DAY).length > 0;
    return { quizDue, newDue, hasLearned };
  }

  // ============================================================
  //  DOM УТИЛИТЫ
  // ============================================================
  function clear() { app.innerHTML = ""; }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined) {
          node.setAttribute(k, v);
        }
      }
    }
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function speakerButton(text, big) {
    return el("button", {
      class: big ? "speak-btn speak-btn-big" : "speak-btn",
      "aria-label": "Прослушать произношение",
      onclick: () => speak(text)
    }, "🔊");
  }

  function statusBar() {
    const league = leagueForLevel(progress.level);
    const need = xpNeededForLevel(progress.level);
    const pct = progress.level >= MAX_LEVEL ? 100 : Math.round((progress.xp / need) * 100);
    return el("div", { class: "statusbar" },
      el("div", { class: "level-badge", title: league.name },
        el("span", { class: "league-emoji" }, league.emoji),
        el("span", { class: "level-num" }, "Ур. " + progress.level)
      ),
      el("div", { class: "xp-wrap" },
        el("div", { class: "xp-bar" }, el("div", { class: "xp-fill", style: `width:${pct}%` })),
        el("div", { class: "xp-text" },
          progress.level >= MAX_LEVEL ? "МАКС" : `${progress.xp} / ${need} XP`)
      ),
      el("div", { class: "streak", title: "Серия дней" }, "🔥 " + (progress.dayStreak || 0))
    );
  }

  // ---------- Календарь активности ----------
  function renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayStr = today();
    const firstDay = new Date(year, month, 1);
    const lastDate = new Date(year, month + 1, 0).getDate();
    // Пн=0 … Вс=6
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    const log = Object.assign({}, progress.activityLog || {});
    // Backfill сегодняшних точек из date-флагов (работает даже если активность была до обновления кода)
    if (progress.lastNewWordsDate === todayStr)  { if (!log[todayStr]) log[todayStr] = {}; log[todayStr].learned = true; }
    if (progress.lastDailyQuizDate === todayStr) { if (!log[todayStr]) log[todayStr] = {}; log[todayStr].quiz   = true; }
    const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

    const wrap = el("div", { class: "cal-wrap" });
    wrap.appendChild(el("div", { class: "cal-header" },
      `${MONTHS_RU[month]} ${year}`));

    const grid = el("div", { class: "cal-grid" });
    DOW.forEach((d) => grid.appendChild(el("div", { class: "cal-dow" }, d)));

    for (let i = 0; i < startDow; i++) {
      grid.appendChild(el("div", { class: "cal-empty" }));
    }

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = dateStr === todayStr;
      const act = log[dateStr] || {};

      const dayEl = el("div", { class: "cal-day" + (isToday ? " today" : "") });
      dayEl.appendChild(el("span", { class: "cal-day-num" }, String(d)));
      if (act.learned || act.quiz) {
        const dots = el("div", { class: "cal-dots" });
        if (act.learned) dots.appendChild(el("span", { class: "cal-dot cal-dot-blue" }));
        if (act.quiz)    dots.appendChild(el("span", { class: "cal-dot cal-dot-yellow" }));
        dayEl.appendChild(dots);
      }
      grid.appendChild(dayEl);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  // ============================================================
  //  ГЛАВНЫЙ ЭКРАН
  // ============================================================
  function renderHome() {
    clear();
    const st = dayState();
    const learnedCount = progress.learnedWordIds.length;

    const card = el("div", { class: "card home-card" });

    card.appendChild(el("div", { class: "home-hero" },
      el("div", { class: "flag-stripe" }),
      el("h1", { class: "app-title" }, "Украинский каждый день"),
      el("p", { class: "subtitle" }, "Маленькие шаги к большому словарю")
    ));

    card.appendChild(statusBar());

    card.appendChild(el("div", { class: "stat-row" },
      el("div", { class: "stat-pill" },
        el("div", { class: "stat-num" }, String(learnedCount)),
        el("div", { class: "stat-lbl" }, "слов выучено")),
      el("div", { class: "stat-pill" },
        el("div", { class: "stat-num" }, String(remainingNewWords())),
        el("div", { class: "stat-lbl" }, "ещё впереди"))
    ));

    // Календарь активности
    card.appendChild(renderCalendar());

    const actions = el("div", { class: "actions" });

    if (st.quizDue) {
      actions.appendChild(el("button", { class: "btn btn-primary", onclick: startDailyQuiz },
        "📋 Ежедневный квиз"));
    } else if (st.hasLearned) {
      actions.appendChild(el("div", { class: "done-note" }, "✅ Ежедневный квиз пройден"));
    }

    if (st.newDue) {
      actions.appendChild(el("button", {
        class: st.quizDue ? "btn btn-secondary" : "btn btn-primary",
        onclick: startLearnNew
      }, "✨ Выучить " + NEW_WORDS_PER_DAY + " новых слова"));
    } else {
      actions.appendChild(el("div", { class: "done-note" },
        remainingNewWords() === 0 ? "🎉 Все слова словаря выучены!" : "✅ Новые слова на сегодня выучены"));
    }

    // Кнопка «Хочу ещё» когда дневная норма выполнена
    if (!st.quizDue && !st.newDue && remainingNewWords() > 0) {
      actions.appendChild(el("button", { class: "btn btn-secondary", onclick: startExtraLearning },
        "📚 Хочу учить ещё!"));
    }

    if (!st.quizDue && !st.newDue) {
      actions.appendChild(el("div", { class: "all-done" }, "На сегодня всё! Возвращайся завтра 🌙"));
    }

    card.appendChild(actions);

    // Практика (всегда если есть что проверять)
    if (learnedCount > 0) {
      card.appendChild(el("button", { class: "btn btn-ghost", onclick: startPracticeQuiz },
        "🔁 Проверить себя"));
    }

    card.appendChild(el("button", { class: "btn btn-ghost", onclick: renderProfile },
      "📖 Мой словарь и профиль"));

    card.appendChild(el("div", { class: "app-version" }, "v1.0.6"));

    app.appendChild(card);
  }

  // ============================================================
  //  ИЗУЧЕНИЕ НОВЫХ СЛОВ
  // ============================================================
  let learnQueue = [];
  let learnPos = 0;

  function startLearnNew() {
    isExtraLearning = false;
    learnQueue = pickNewWords(NEW_WORDS_PER_DAY);
    learnPos = 0;
    if (learnQueue.length === 0) { renderHome(); return; }
    renderIntroduce();
  }

  function startExtraLearning() {
    isExtraLearning = true;
    learnQueue = pickNewWords(NEW_WORDS_PER_DAY);
    learnPos = 0;
    if (learnQueue.length === 0) { isExtraLearning = false; renderHome(); return; }
    renderIntroduce();
  }

  function renderIntroduce() {
    clear();
    const word = learnQueue[learnPos];
    const card = el("div", { class: "card" });

    if (isExtraLearning) {
      card.appendChild(el("div", { class: "quiz-progress" }, "Бонусное изучение"));
    }

    card.appendChild(el("div", { class: "progress-dots" },
      ...learnQueue.map((_, i) =>
        el("span", { class: "dot " + (i < learnPos ? "dot-done" : i === learnPos ? "dot-active" : "") }))
    ));

    card.appendChild(el("div", { class: "word-hero" },
      el("div", { class: "word-uk-row" },
        el("span", { class: "word-uk" }, word.uk),
        speakerButton(word.uk, true)
      ),
      word.pos ? el("div", { class: "word-pos" }, posLabel(word.pos)) : null,
      el("div", { class: "word-ru" }, word.ru)
    ));

    const ex = el("div", { class: "examples" });
    ex.appendChild(el("div", { class: "examples-title" }, "Примеры:"));
    for (const e of (word.examples || [])) {
      ex.appendChild(el("div", { class: "example" },
        el("div", { class: "ex-uk-row" },
          el("span", { class: "ex-uk" }, e.uk),
          speakerButton(e.uk, false)),
        el("div", { class: "ex-ru" }, e.ru)
      ));
    }
    card.appendChild(ex);

    card.appendChild(el("button", { class: "btn btn-primary",
      onclick: () => startWordQuiz(word) }, "Проверить себя →"));

    app.appendChild(card);
    setTimeout(() => speak(word.uk), 250);
  }

  function buildWordQuestions(word) {
    const qs = [];
    qs.push({
      prompt: "Что означает слово?",
      term: word.uk, speak: word.uk,
      correct: word.ru, options: translationOptions(word, "ru")
    });
    qs.push({
      prompt: "Как будет по-украински?",
      term: word.ru, speak: null,
      correct: word.uk, options: translationOptions(word, "uk")
    });
    const example = (word.examples || [])[0];
    if (example) {
      const re = new RegExp(word.uk, "i");
      const gapped = re.test(example.uk) ? example.uk.replace(re, "____") : null;
      if (gapped) {
        qs.push({
          prompt: "Вставь слово в предложение:",
          term: gapped, hint: example.ru, speak: null,
          correct: word.uk, options: translationOptions(word, "uk")
        });
      }
    }
    return qs.slice(0, QUIZ_QUESTIONS_PER_WORD);
  }

  let wordQuiz = null;

  function startWordQuiz(word) {
    wordQuiz = { word, questions: buildWordQuestions(word), idx: 0 };
    renderWordQuiz();
  }

  function renderWordQuiz() {
    if (document.activeElement) document.activeElement.blur();
    clear();
    const q = wordQuiz.questions[wordQuiz.idx];
    const card = el("div", { class: "card" });

    card.appendChild(el("div", { class: "quiz-progress" },
      `Запоминание · ${wordQuiz.idx + 1}/${wordQuiz.questions.length}`));
    card.appendChild(el("div", { class: "q-prompt" }, q.prompt));

    const termRow = el("div", { class: "q-term-row" },
      el("span", { class: "q-term" }, q.term));
    if (q.speak) termRow.appendChild(speakerButton(q.speak, false));
    card.appendChild(termRow);
    if (q.hint) card.appendChild(el("div", { class: "q-hint" }, "(" + q.hint + ")"));

    const opts = el("div", { class: "options" });
    for (const opt of q.options) {
      opts.appendChild(el("button", { class: "option",
        onclick: (ev) => onWordAnswer(ev.currentTarget, opt, q.correct, opts) }, opt));
    }
    card.appendChild(opts);
    app.appendChild(card);
  }

  function onWordAnswer(btn, choice, correct, optsContainer) {
    const buttons = optsContainer.querySelectorAll(".option");
    buttons.forEach((b) => (b.disabled = true));
    const ok = choice === correct;
    playSound(ok ? "correct" : "wrong");
    vibrate(ok ? "correct" : "wrong");
    if (ok) {
      btn.classList.add("correct");
    } else {
      btn.classList.add("wrong");
      buttons.forEach((b) => { if (b.textContent === correct) b.classList.add("correct"); });
    }
    setTimeout(() => {
      wordQuiz.idx += 1;
      if (wordQuiz.idx < wordQuiz.questions.length) renderWordQuiz();
      else finishWordQuiz();
    }, ok ? 650 : 1300);
  }

  function finishWordQuiz() {
    const word = wordQuiz.word;
    if (!progress.learnedWordIds.includes(word.id)) {
      progress.learnedWordIds.push(word.id);
      addXp(XP_PER_NEW_WORD);
    }
    progress.wordStates[word.id] = { status: "learned", learnedOn: today(), reviewMisses: 0 };
    logActivity("learned");
    advanceNewWordIndex();
    save();

    learnPos += 1;
    if (learnPos < learnQueue.length) {
      maybeLevelUp(renderIntroduce);
    } else {
      if (!isExtraLearning) {
        progress.lastNewWordsDate = today();
        bumpStreak();
        save();
      }
      isExtraLearning = false;
      maybeLevelUp(() => renderDayComplete("new"));
    }
  }

  function advanceNewWordIndex() {
    while (progress.newWordIndex < WORDS.length) {
      const w = WORDS[progress.newWordIndex];
      const st = progress.wordStates[w.id];
      if (st && st.status === "learned") progress.newWordIndex++;
      else break;
    }
  }

  // Показывает оверлей уровня если накоплен, затем вызывает callback.
  function maybeLevelUp(callback) {
    if (pendingLevelUp) {
      const lu = pendingLevelUp; pendingLevelUp = null;
      showLevelUp(lu.prevLevel, lu.newLevel, callback);
    } else {
      callback();
    }
  }

  // ============================================================
  //  ЕЖЕДНЕВНЫЙ КВИЗ
  // ============================================================
  let daily = null;

  function startDailyQuiz() {
    practiceMode = false;
    const pool = learnedWords();
    const chosen = shuffle(pool).slice(0, Math.min(DAILY_QUIZ_SIZE, pool.length));
    daily = { words: chosen, idx: 0, retry: false, correctCount: 0, forgotten: [] };
    renderDailyQuestion();
  }

  // ============================================================
  //  ПРАКТИКА (без XP, без штрафов, без лимита)
  // ============================================================
  function startPracticeQuiz() {
    const pool = learnedWords();
    if (pool.length === 0) return;
    practiceMode = true;
    const chosen = shuffle(pool).slice(0, Math.min(DAILY_QUIZ_SIZE, pool.length));
    daily = { words: chosen, idx: 0, retry: false, correctCount: 0, forgotten: [] };
    renderDailyQuestion();
  }

  function renderDailyQuestion() {
    if (document.activeElement) document.activeElement.blur();
    clear();
    const word = daily.words[daily.idx];
    const card = el("div", { class: "card" });

    const header = practiceMode
      ? `Практика · ${daily.idx + 1}/${daily.words.length}`
      : `Ежедневный квиз · ${daily.idx + 1}/${daily.words.length}`;
    const progressRow = el("div", { class: "quiz-progress-row" },
      el("div", { class: "quiz-progress" }, header));
    if (practiceMode) {
      progressRow.appendChild(el("button", { class: "quit-btn", onclick: () => { practiceMode = false; renderHome(); } }, "✕"));
    }
    card.appendChild(progressRow);

    card.appendChild(el("div", { class: "q-prompt" },
      daily.retry ? "Ещё раз — выберите перевод:" : "Выберите перевод слова:"));

    const termRow = el("div", { class: "q-term-row" },
      el("span", { class: "q-term" }, word.uk),
      speakerButton(word.uk, false));
    card.appendChild(termRow);

    if (daily.retry && !practiceMode) {
      card.appendChild(el("div", { class: "retry-flag" }, "⚠️ Последняя попытка"));
    }

    const options = translationOptions(word, "ru");
    const opts = el("div", { class: "options" });
    for (const opt of options) {
      opts.appendChild(el("button", { class: "option",
        onclick: (ev) => onDailyAnswer(ev.currentTarget, opt, word.ru, opts) }, opt));
    }
    card.appendChild(opts);
    app.appendChild(card);
  }

  function onDailyAnswer(btn, choice, correct, optsContainer) {
    const buttons = optsContainer.querySelectorAll(".option");
    buttons.forEach((b) => (b.disabled = true));
    const ok = choice === correct;
    const word = daily.words[daily.idx];

    playSound(ok ? "correct" : "wrong");
    vibrate(ok ? "correct" : "wrong");

    if (ok) {
      btn.classList.add("correct");
      daily.correctCount += 1;
      if (!practiceMode) addXp(XP_PER_QUIZ_WORD);
      proceedDaily(700);
    } else {
      btn.classList.add("wrong");
      buttons.forEach((b) => { if (b.textContent === correct) b.classList.add("correct"); });
      if (practiceMode) {
        // В практике: нет ретрая, нет штрафа — просто двигаемся дальше
        proceedDaily(1300);
      } else if (!daily.retry) {
        daily.retry = true;
        setTimeout(renderDailyQuestion, 1300);
      } else {
        markForgotten(word);
        daily.forgotten.push(word);
        proceedDaily(1400);
      }
    }
  }

  function proceedDaily(delay) {
    setTimeout(() => {
      daily.retry = false;
      daily.idx += 1;
      if (daily.idx < daily.words.length) renderDailyQuestion();
      else finishDailyQuiz();
    }, delay);
  }

  function markForgotten(word) {
    const i = progress.learnedWordIds.indexOf(word.id);
    if (i >= 0) progress.learnedWordIds.splice(i, 1);
    const st = progress.wordStates[word.id] || {};
    progress.wordStates[word.id] = {
      status: "forgotten",
      learnedOn: st.learnedOn || null,
      reviewMisses: (st.reviewMisses || 0) + 1
    };
    const idx = WORDS.findIndex((w) => w.id === word.id);
    if (idx >= 0 && idx < progress.newWordIndex) progress.newWordIndex = idx;
  }

  function finishDailyQuiz() {
    if (practiceMode) {
      practiceMode = false;
      renderPracticeComplete();
      return;
    }
    progress.lastDailyQuizDate = today();
    logActivity("quiz");
    bumpStreak();
    save();
    maybeLevelUp(() => renderDayComplete("quiz"));
  }

  // ============================================================
  //  ЭКРАН ИТОГА ДНЯ
  // ============================================================
  function renderDayComplete(source) {
    clear();
    const st = dayState();
    const card = el("div", { class: "card center-card" });

    if (source === "quiz") {
      card.appendChild(el("div", { class: "big-emoji" }, daily.forgotten.length ? "💪" : "🎉"));
      card.appendChild(el("h2", null, "Квиз пройден!"));
      card.appendChild(el("p", { class: "result-line" },
        `Правильно: ${daily.correctCount} из ${daily.words.length}`));
      if (daily.forgotten.length) {
        card.appendChild(el("p", { class: "forgot-line" },
          "Забытые слова вернутся в обучение: " +
          daily.forgotten.map((w) => w.uk).join(", ")));
      }
    } else {
      card.appendChild(el("div", { class: "big-emoji" }, "✨"));
      card.appendChild(el("h2", null, "Новые слова выучены!"));
      card.appendChild(el("p", { class: "result-line" },
        `+${learnQueue.length * XP_PER_NEW_WORD} XP · всего выучено ${progress.learnedWordIds.length} слов`));
    }

    card.appendChild(statusBar());

    if (source === "quiz" && st.newDue) {
      card.appendChild(el("button", { class: "btn btn-primary", onclick: startLearnNew },
        "✨ Теперь новые слова →"));
    }

    // «Хочу ещё» — доступно всегда если есть слова
    if (remainingNewWords() > 0) {
      card.appendChild(el("button", { class: "btn btn-secondary", onclick: startExtraLearning },
        "📚 Хочу учить ещё!"));
    }

    card.appendChild(el("button", { class: "btn btn-ghost", onclick: renderHome }, "На главную"));
    app.appendChild(card);
  }

  // ---------- Итог практики ----------
  function renderPracticeComplete() {
    clear();
    const card = el("div", { class: "card center-card" });
    card.appendChild(el("div", { class: "big-emoji" },
      daily.correctCount === daily.words.length ? "🎯" : "💪"));
    card.appendChild(el("h2", null, "Практика завершена"));
    card.appendChild(el("p", { class: "result-line" },
      `Правильно: ${daily.correctCount} из ${daily.words.length}`));
    if (learnedWords().length > 0) {
      card.appendChild(el("button", { class: "btn btn-secondary", onclick: startPracticeQuiz },
        "🔁 Ещё раз"));
    }
    card.appendChild(el("button", { class: "btn btn-ghost", onclick: renderHome }, "На главную"));
    app.appendChild(card);
  }

  // ============================================================
  //  ПРОФИЛЬ / СЛОВАРЬ
  // ============================================================
  function renderProfile() {
    clear();
    const league = leagueForLevel(progress.level);
    const card = el("div", { class: "card" });

    card.appendChild(el("div", { class: "profile-head" },
      el("button", { class: "back-btn", onclick: renderHome }, "← Назад"),
      el("h2", null, "Профиль")
    ));

    card.appendChild(el("div", { class: "profile-hero" },
      el("div", { class: "big-league" }, league.emoji),
      el("div", { class: "big-level" }, "Уровень " + progress.level),
      el("div", { class: "league-name" }, league.name)
    ));

    card.appendChild(statusBar());

    card.appendChild(el("div", { class: "stat-row" },
      el("div", { class: "stat-pill" },
        el("div", { class: "stat-num" }, String(progress.learnedWordIds.length)),
        el("div", { class: "stat-lbl" }, "слов выучено")),
      el("div", { class: "stat-pill" },
        el("div", { class: "stat-num" }, "🔥 " + (progress.dayStreak || 0)),
        el("div", { class: "stat-lbl" }, "серия дней"))
    ));

    card.appendChild(el("h3", { class: "dict-title" }, "Мой словарь"));
    const search = el("input", { class: "search", type: "text", placeholder: "Поиск слова…" });
    card.appendChild(search);

    const list = el("div", { class: "dict-list" });
    function renderList(filter) {
      list.innerHTML = "";
      const items = learnedWords().slice().reverse()
        .filter((w) => !filter ||
          w.uk.toLowerCase().includes(filter) || w.ru.toLowerCase().includes(filter));
      if (items.length === 0) {
        list.appendChild(el("div", { class: "dict-empty" },
          filter ? "Ничего не найдено" : "Пока пусто — выучи первые слова!"));
        return;
      }
      for (const w of items) {
        list.appendChild(el("div", { class: "dict-item" },
          el("div", { class: "dict-words" },
            el("span", { class: "dict-uk" }, w.uk),
            el("span", { class: "dict-ru" }, w.ru)),
          speakerButton(w.uk, false)
        ));
      }
    }
    renderList("");
    search.addEventListener("input", () => renderList(search.value.trim().toLowerCase()));
    card.appendChild(list);

    const tools = el("div", { class: "tools" });
    tools.appendChild(el("button", { class: "btn btn-ghost", onclick: doExport },
      "⬇️ Экспорт прогресса"));
    const importBtn = el("button", { class: "btn btn-ghost" }, "⬆️ Импорт прогресса");
    const fileInput = el("input", { type: "file", accept: "application/json,.json",
      style: "display:none" });
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => doImport(fileInput.files[0]));
    tools.appendChild(importBtn);
    tools.appendChild(fileInput);
    tools.appendChild(el("button", { class: "btn btn-danger", onclick: doReset },
      "Сбросить весь прогресс"));
    card.appendChild(tools);

    app.appendChild(card);
  }

  function doExport() {
    const blob = new Blob([window.Storage.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ukr-progres-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function doImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        progress = window.Storage.importJSON(reader.result);
        alert("Прогресс успешно импортирован!");
        renderProfile();
      } catch (e) {
        alert("Не удалось прочитать файл. Убедитесь, что это корректный JSON экспорта.");
      }
    };
    reader.readAsText(file);
  }

  function doReset() {
    if (!confirm("Сбросить весь прогресс? Это действие нельзя отменить.")) return;
    progress = window.Storage.reset();
    renderHome();
  }

  // ---------- Старт ----------
  if (WORDS.length === 0) {
    app.appendChild(el("div", { class: "card" },
      el("p", null, "Словарь не загрузился. Проверьте файл data/words.js.")));
  } else {
    renderHome();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // Принудительно проверяем обновление при каждом запуске
        reg.update();
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            // Новый SW установлен и готов — перезагружаем страницу
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });
      }).catch(() => {});
    });
  }
})();
