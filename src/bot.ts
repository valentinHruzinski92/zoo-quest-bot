import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import path from 'path';
import questionsJson from './questions.json';
import translationsJson from './translations.json';

dotenv.config();
const token = process.env.TELEGRAM_TOKEN!;

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

enum Commands {
  restart = 'restart',
  repeatQuestion = 'repeat_question',
  map = 'map',
  answer = 'answer',
}

const chooseLanguageText = 'Выберите язык / Choose language';
const chooseLanguageErrorText = 'Пожалуйста, выберите язык с клавиатуры ниже. / Please select a language from the keyboard below.';

interface Question {
  question: string;
  answers: string[];
  specialIncorrectAnswers: string[];
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
const bot = new TelegramBot(token, { polling: true });

bot.onText(new RegExp(`^/${Commands.restart}$`), (msg) => {
  const chatId = msg.chat.id;
  return onStartSession(chatId);
});

bot.onText(new RegExp(`^/${Commands.repeatQuestion}$`), (msg) => {
  const chatId = msg.chat.id;

  return sendQuestion(chatId);
});

bot.onText(new RegExp(`^/${Commands.map}$`), (msg) => {
  const chatId = msg.chat.id;
  return sendMap(chatId);
});

bot.onText(new RegExp(`^/${Commands.answer}$`), async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];

  await bot.sendMessage(chatId, `${translations[lang].correctAnswerIs}"${q.answers.join('", "')}"`);

  session.currentQuestion!++;
  session.currentHint = null;
  return sendQuestion(chatId);
});


bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || '';

  if (!userSessions.has(chatId)) {
    return onStartSession(chatId);
  }

  if (Object.values(Commands).map(v => `/${v}`).includes(text))
    return;

  const session = userSessions.get(chatId)!;

  if (session.stage === Stage.chooseLang) {
    return bot.sendMessage(chatId, chooseLanguageErrorText);
  }

  const lang = session.lang as Language;

  if (session.stage === Stage.start) {
    return bot.sendMessage(chatId, translations[lang].pressStart);
  }

  if (session.stage === Stage.quiz) {
    return onQuizAnswer(text, chatId);
  }

  if (session.stage === Stage.finished) {
    return onFinished(chatId);
  }
});

bot.on('callback_query', (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data;
  const session = userSessions.get(chatId as number)!;

  if (!chatId || !data) return;

  switch (data) {
    case `${CallbackType.chooseLanguage}_${Language.ru}`:
      onChooseLanguage(Language.ru, chatId);
      break;
    case `${CallbackType.chooseLanguage}_${Language.en}`:
      onChooseLanguage(Language.en, chatId);
      break;
    case CallbackType.commandStart:
      onStartClick(chatId);
      break;
    case CallbackType.commandHint:
      onHintClick(chatId);
      break;
    case CallbackType.commandRestart:
      onStartSession(chatId);
      break
  }

  return bot.answerCallbackQuery(query.id);
});

function setBotCommands(chatId: number) {
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language || Language.en;
  const commands = [{ command: Commands.restart, description: translations[lang].restart }]

  if (session.stage === Stage.quiz) {
    commands.unshift({ command: Commands.answer, description: translations[lang].correctAnswer });
    commands.unshift({ command: Commands.repeatQuestion, description: translations[lang].repeatQuestion });
    commands.unshift({ command: Commands.map, description: translations[lang].map });
  }

  bot.setMyCommands(
    commands,
    {
      scope: {
        type: 'chat',
        chat_id: chatId
      }
    });
}

function onStartSession(chatId: number) {
  userSessions.set(chatId, { stage: Stage.chooseLang });
  const session = userSessions.get(chatId as number)!;
  setBotCommands(chatId);
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

function onChooseLanguage(lang: Language, chatId: number) {
  const session = userSessions.get(chatId)!;
  session.lang = lang;
  session.stage = Stage.start;
  setBotCommands(chatId);

  bot.sendMessage(chatId, translations[lang].toStart, {
    reply_markup: {
      inline_keyboard: [[{ text: translations[lang].start, callback_data: CallbackType.commandStart }]],
      one_time_keyboard: true,
    }
  });
}

function onStartClick(chatId: number) {
  const session = userSessions.get(chatId)!;
  session.stage = Stage.quiz;
  session.currentQuestion = 0;
  session.currentHint = null;
  setBotCommands(chatId);
  sendQuestion(chatId);
}

function onHintClick(chatId: number) {
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];
  const nextHintIndex = !Number.isInteger(session.currentHint) ? 0 : session.currentHint! + 1;
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

async function onQuizAnswer(messageText: string, chatId: number) {
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];

  if (q.specialIncorrectAnswers.map((a) => a.toLowerCase()).includes(messageText.toLowerCase())) {
    return bot.sendMessage(chatId, translations[lang].rereadQuestionMessage);
  } else if (q.answers.map((a) => a.toLowerCase()).includes(messageText.toLowerCase())) {
    session.currentQuestion!++;
    session.currentHint = null;

    if (session.currentQuestion! >= questions[lang].length) {
      session.stage = Stage.finished;
      return bot.sendMessage(chatId, translations[lang].congratulations, {
        reply_markup: {
          inline_keyboard: [[{ text: translations[lang].restart, callback_data: CallbackType.commandRestart }]],
          one_time_keyboard: true,
        }
      });
    } else {
      await bot.sendMessage(chatId, translations[lang].correctAnswerMessage);
      return sendQuestion(chatId);
    }
  } else {
    return bot.sendMessage(chatId, translations[lang].incorrectAnswer);
  }
}

function onFinished(chatId: number) {
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  setBotCommands(chatId);
  bot.sendMessage(chatId, translations[lang].finished);
}


function sendQuestion(chatId: number) {
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  const q = questions[lang][session.currentQuestion!];

  bot.sendMessage(chatId, q.question, {
    reply_markup: {
      inline_keyboard: [[{ text: translations[lang].hint, callback_data: CallbackType.commandHint }]],
      one_time_keyboard: true,
    }
  });
}

async function sendMap(chatId: number) {
  const filePath = path.join(__dirname, './assets/zoo-map.jpg');
  const session = userSessions.get(chatId)!;
  const lang = session.lang as Language;
  await bot.sendMessage(chatId, translations[lang].waitAMomentMapLoading);

  bot.sendPhoto(chatId, filePath, {
    caption: translations[lang].mapNotes
  });
}