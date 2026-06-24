// Обёртка над localStorage: загрузка/сохранение прогресса, инициализация, экспорт/импорт.
(function () {
  "use strict";

  const STORAGE_KEY = "uk_progress_v1";
  const SCHEMA_VERSION = 1;

  function today() {
    // Локальный календарный день в формате YYYY-MM-DD.
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function defaultProgress() {
    return {
      schemaVersion: SCHEMA_VERSION,
      startedAt: today(),
      xp: 0,
      level: 1,
      learnedWordIds: [],     // словарь выученных (в порядке изучения)
      wordStates: {},         // { [id]: { status, learnedOn, reviewMisses } }
      lastNewWordsDate: null, // когда последний раз брали новые слова
      lastDailyQuizDate: null,// когда последний раз проходили дейли-квиз
      newWordIndex: 0,        // указатель на следующее слово в WORDS
      dayStreak: 0,
      lastActiveDate: null,   // для подсчёта streak
      activityLog: {},        // { "YYYY-MM-DD": { learned: bool, quiz: bool, phrase: bool } }
      autoSpeak: true,        // автоозвучка при показе нового слова
      lastPhraseDate: null,   // когда последний раз смотрели фразу дня (для XP)
      dismissedToday: null    // { date, quiz, new } — скрытые done-уведомления
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      const data = JSON.parse(raw);
      // Лёгкая миграция: добиваем недостающие поля дефолтами.
      return Object.assign(defaultProgress(), data);
    } catch (e) {
      console.warn("Не вдалося завантажити прогрес, починаємо заново.", e);
      return defaultProgress();
    }
  }

  function save(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      console.error("Не вдалося зберегти прогрес.", e);
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    return defaultProgress();
  }

  function exportJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function importJSON(text) {
    const data = JSON.parse(text); // бросит исключение при невалидном JSON
    const merged = Object.assign(defaultProgress(), data);
    save(merged);
    return merged;
  }

  window.Storage = {
    STORAGE_KEY,
    today,
    defaultProgress,
    load,
    save,
    reset,
    exportJSON,
    importJSON
  };
})();
