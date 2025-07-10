import TelegramBot from 'node-telegram-bot-api';
import questionsJson from './questions.json';
import translationsJson from './translations.json';

const token = '7740136274:AAFLD5_h5nxIhmHdMNbo58xPbl3qMr7bigk';
const bot = new TelegramBot(token, { polling: true });
const restartCommand = '/restart';

enum Language {
  ru = 'ru',
  en = 'en'
}

enum Stage {
  chooseLang = 'chooseLang',
  start = 'start',
  quiz = 'quiz',
  finished = 'finished'
}

enum CallbackType {
  chooseLanguage = 'choose_language',
  commandStart = 'command_start',
  commandHint = 'command_hint',
  commandRestart = 'command_restart',
}

const chooseLanguageText = 'Выберите язык / Choose language';
const chooseLanguageErrorText = 'Пожалуйста, выберите язык с клавиатуры ниже. / Please select a language from the keyboard below.';

interface Question {
  question: string;
  answers: string[];
  hints: string[];
}

interface Session {
  stage: Stage;
  lang?: Language;
  currentQuestion?: number;
  currentHint?: number | null;
}

const questions: Record<Language, Question[]> = questionsJson;
const translations: Record<Language, { [key: string]: string }> = translationsJson;

const userSessions = new Map<number, Session>();

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || '';

  if (!userSessions.has(chatId)) {
    return onStartSession(chatId);
  }

  const session = userSessions.get(chatId)!;

  if(text === restartCommand) {
    return onStartSession(chatId);
  }

  if (session.stage === Stage.chooseLang) {
    return bot.sendMessage(chatId, chooseLanguageErrorText);
  }

  const lang = session.lang as Language;

  if (session.stage === Stage.start) {
    return bot.sendMessage(chatId, translations[lang].pressStart);
  }

  if (session.stage === Stage.quiz) {
    return onQuizAnswer(session, text, chatId);
  }

  if (session.stage === Stage.finished) {
    return onFinished(session, chatId);
  }
});

bot.on('callback_query', (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data;
  const session = userSessions.get(chatId as number)!;

  if (!chatId || !data) return;

  switch (data) {
    case `${CallbackType.chooseLanguage}_${Language.ru}`:
      onChooseLanguage(session, Language.ru, chatId);
      break;
    case `${CallbackType.chooseLanguage}_${Language.en}`:
      onChooseLanguage(session, Language.en, chatId);
      break;
    case CallbackType.commandStart:
      onStartClick(session, chatId);
      break;
    case CallbackType.commandHint:
      onHintClick(session, chatId);
      break;
    case CallbackType.commandRestart:
      onStartSession(chatId);
      break
  }

  return bot.answerCallbackQuery(query.id);
});

function onStartSession(chatId: number) {
  userSessions.set(chatId, { stage: Stage.chooseLang });
  bot.sendMessage(chatId, chooseLanguageText, {
    reply_markup: {
      inline_keyboard: [[
        {
          text: 'Русский',
          callback_data: `${CallbackType.chooseLanguage}_${Language.ru}`
        }, {
          text: 'English',
          callback_data: `${CallbackType.chooseLanguage}_${Language.en}`
        }
      ]],
      one_time_keyboard: true,
    }
  });
}

function onChooseLanguage(session: any, lang: Language, chatId: number) {
  session.lang = lang;
  session.stage = Stage.start;

  bot.sendMessage(chatId, translations[lang].toStart, {
    reply_markup: {
      inline_keyboard: [[{ text: translations[lang].start, callback_data: CallbackType.commandStart }]],
      one_time_keyboard: true,
    }
  });
}

function onStartClick(session: any, chatId: number) {
  session.stage = Stage.quiz;
  session.currentQuestion = 0;
  sendQuestion(chatId, session);
}

function onHintClick(session: any, chatId: number) {
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];
  const nextHintIndex = session.currentHint === null ? 0 : session.currentHint + 1;
  const nextHint = q.hints[nextHintIndex];
  const isLastHint = nextHintIndex >= q.hints.length - 1;
  session.currentHint = nextHintIndex;

  if (nextHint) {
    bot.sendMessage(
      chatId,
      nextHint,
      !isLastHint ? {
        reply_markup: {
          inline_keyboard: [[{ text: translations[lang].hint, callback_data: CallbackType.commandHint }]],
          one_time_keyboard: true,
        }
      } : undefined)
  } else {
    bot.sendMessage(chatId, translations[lang].noMoreHints);
  }
}

function onQuizAnswer(session: any, messageText: string, chatId: number) {
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];

  if (q.answers.includes(messageText.toLowerCase())) {
    session.currentQuestion!++;
    if (session.currentQuestion! >= questions[lang].length) {
      session.stage = Stage.finished;
      bot.sendMessage(chatId, translations[lang].congratulations);
    } else {
      sendQuestion(chatId, session);
    }
  } else {
    bot.sendMessage(chatId, translations[lang].incorrectAnswer);
  }
}

function onFinished(session: any, chatId: number) {
  const lang = session.lang as Language;

  bot.sendMessage(chatId, translations[lang].finished, {
    reply_markup: {
      inline_keyboard: [[{ text: translations[lang].restart, callback_data: CallbackType.commandRestart }]],
      one_time_keyboard: true,
    }
  });
}


function sendQuestion(chatId: number, session: Session) {
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];
  session.currentHint = null;

  bot.sendMessage(chatId, q.question, {
    reply_markup: {
      inline_keyboard: [[{ text: translations[lang].hint, callback_data: CallbackType.commandHint }]],
      one_time_keyboard: true,
    }
  });
}