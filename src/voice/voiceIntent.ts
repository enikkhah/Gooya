/**
 * ماژول مستقل فهم دستور فارسی (Rule-Based & Offline)
 * بدون وابستگی به سرویس‌های بیرونی یا LLM
 */

import { getTranscript } from "./getTranscript";

export { getTranscript };

export type VoiceIntent =
  | "create_reminder"
  | "create_occasion"
  | "save_place"
  | "capture_idea"
  | "unknown";

export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly";

export interface ParsedEntities {
  title?: string;
  date?: string;               // میلادی ISO: YYYY-MM-DD
  dateJalali?: string;         // شمسی: YYYY-MM-DD (مثل 1405-08-13)
  time?: string;               // HH:mm به صورت ۲۴ ساعته
  recurrence?: RecurrenceType;
  recurrenceInterval?: number; // گام تکرار (مثلاً ۳ برای «هر سه روز یکبار»)
  recurrenceDays?: string[];   // روزهای تکرار در هفته (مثلاً ["شنبه", "سهشنبه"])
}

export interface ParsedCommand {
  text: string;          // متن نرمال‌شده
  intent: VoiceIntent;
  confidence: number;    // ۰ تا ۱
  entities: ParsedEntities;
}

// ==================== تبدیل تاریخ شمسی و میلادی ====================

/**
 * تبدیل تاریخ میلادی به شمسی (جلالی)
 */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number
): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm =
    days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/**
 * تبدیل تاریخ شمسی (جلالی) به میلادی
 */
export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number
): [number, number, number] {
  const jy1 = jy + 1595;
  let days =
    -355668 +
    365 * jy1 +
    Math.floor(jy1 / 33) * 8 +
    Math.floor(((jy1 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal_a = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) {
    gd -= sal_a[gm];
  }
  return [gy, gm, gd];
}

/**
 * محاسبه تعداد روزهای یک ماه شمسی (با پشتیبانی از سال کبیسه)
 */
export function getJalaliMonthLength(jy: number, jm: number): number {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  // برای اسفند (ماه ۱۲)، بررسی می‌کنیم که آیا روز ۳۰ام به فروردین سال بعد می‌افتد یا خیر
  const [gy, gm, gd] = jalaliToGregorian(jy, 12, 30);
  const [checkJy, checkJm, checkJd] = gregorianToJalali(gy, gm, gd);
  return checkJy === jy && checkJm === 12 && checkJd === 30 ? 30 : 29;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatGregorianISO(gy: number, gm: number, gd: number): string {
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

export function formatJalaliISO(jy: number, jm: number, jd: number): string {
  return `${jy}-${pad2(jm)}-${pad2(jd)}`;
}

function addGregorianDays(base: Date, daysToAdd: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + daysToAdd);
  return d;
}

function dateToBothFormats(d: Date): { date: string; dateJalali: string } {
  const gy = d.getFullYear();
  const gm = d.getMonth() + 1;
  const gd = d.getDate();
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(jy, jm, jd),
  };
}

// ==================== نرمال‌سازی متن و اعداد فارسی ====================

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const TENS_WORDS: Record<string, number> = {
  بیست: 20,
  سی: 30,
  چهل: 40,
  پنجاه: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
};

const UNITS_WORDS: Record<string, number> = {
  یک: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  چاهار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
};

const TEENS_WORDS: Record<string, number> = {
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  پونزده: 15,
  شانزده: 16,
  شونزده: 16,
  هفده: 17,
  هیفده: 17,
  هوده: 17,
  هجده: 18,
  هیجده: 18,
  هشده: 18,
  نوزده: 19,
};

const ORDINAL_WORDS: Record<string, number> = {
  اول: 1,
  یکم: 1,
  دوم: 2,
  سوم: 3,
  چهارم: 4,
  پنجم: 5,
  ششم: 6,
  شیشم: 6,
  هفتم: 7,
  هشتم: 8,
  نهم: 9,
  دهم: 10,
  یازدهم: 11,
  دوازدهم: 12,
  سیزدهم: 13,
  چهاردهم: 14,
  پانزدهم: 15,
  پونزدهم: 15,
  شانزدهم: 16,
  شونزدهم: 16,
  هفدهم: 17,
  هیفدهم: 17,
  هجدهم: 18,
  هیجدهم: 18,
  نوزدهم: 19,
  بیستم: 20,
  سیام: 30,
};

const JALALI_MONTHS: Record<string, number> = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  امرداد: 5,
  شهریور: 6,
  مهر: 7,
  آبان: 8,
  ابان: 8,
  آذر: 9,
  اذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12,
  اسپند: 12,
};

const MONTH_NAMES_PATTERN =
  "(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|امرداد|شهریور|مهر|آبان|ابان|آذر|اذر|دی|بهمن|اسفند|اسپند)";

/**
 * نرمال‌سازی حروف عربی، ارقام، نیم‌فاصله و تبدیل اعداد حروفی (۱ تا ۹۹)
 */
export function normalizeText(input: string): string {
  if (!input) return "";

  let s = input;

  // ۱. تبدیل ارقام فارسی و عربی به انگلیسی
  for (let i = 0; i < 10; i++) {
    s = s.replace(new RegExp(PERSIAN_DIGITS[i], "g"), String(i));
    s = s.replace(new RegExp(ARABIC_DIGITS[i], "g"), String(i));
  }

  // ۲. تبدیل حروف عربی به فارسی و حذف اعراب و کشیده
  s = s
    .replace(/[يیىئ]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[إأ]/g, "ا")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "");

  // ۳. حذف نیم‌فاصله و کاراکترهای نامرئی
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // ۴. یکسان‌سازی علائم نگارشی (حفظ : در ساعت و / یا - در تاریخ)
  s = s.replace(/[،؛,?؟!«»"']/g, " ");

  // ۵. یکسان‌سازی ترکیبات چندکلمه‌ای قبل از تبدیل اعداد تا «پنج شنبه» به «5 شنبه» تبدیل نشود
  s = s
    .replace(/(?:^|\s)یک\s+شنبه(?=\s|$)/g, " یکشنبه")
    .replace(/(?:^|\s)دو\s+شنبه(?=\s|$)/g, " دوشنبه")
    .replace(/(?:^|\s)سه\s+شنبه(?=\s|$)/g, " سهشنبه")
    .replace(/(?:^|\s)چهار\s+شنبه(?=\s|$)/g, " چهارشنبه")
    .replace(/(?:^|\s)پنج\s+شنبه(?=\s|$)/g, " پنجشنبه")
    .replace(/(?:^|\s)پس\s+فردا(?=\s|$)/g, " پسفردا")
    .replace(/(?:^|\s)پری\s+روز(?=\s|$)/g, " پریروز")
    .replace(/(?:^|\s)نیمه\s+شب(?=\s|$)/g, " نیمهشب")
    .replace(/(?:^|\s)نصف\s+شب(?=\s|$)/g, " نیمهشب")
    .replace(/(?:^|\s)نصفه\s+شب(?=\s|$)/g, " نیمهشب")
    .replace(/(?:^|\s)بعد\s+از\s+ظهر(?=\s|$)/g, " بعدازظهر")
    .replace(/(?:^|\s)یاد\s+آوری(?=\s|$)/g, " یادآوری")
    .replace(/(?:^|\s)یک\s*بار(?=\s|$)/g, " یکبار")
    .replace(/(?:^|\s)یه\s*بار(?=\s|$)/g, " یکبار")
    .replace(/(?:^|\s)در\s+میان(?=\s|$)/g, " درمیان")
    .replace(/(?:^|\s)در\s+میون(?=\s|$)/g, " درمیان")
    .replace(/(?:^|\s)درمیون(?=\s|$)/g, " درمیان")
    .replace(/(?:^|\s)سه\s+ربع(?=\s|$)/g, " __SE_ROB__");

  // ۶. تبدیل اعداد ترتیبی مرکب (مثل بیست و یکم -> 21ام)
  const tensKeys = Object.keys(TENS_WORDS).join("|");
  const ordinalUnitMap: Record<string, number> = {
    یکم: 1,
    اول: 1,
    دوم: 2,
    سوم: 3,
    چهارم: 4,
    پنجم: 5,
    ششم: 6,
    شیشم: 6,
    هفتم: 7,
    هشتم: 8,
    نهم: 9,
  };
  const ordinalUnitKeys = Object.keys(ordinalUnitMap).join("|");
  const compoundOrdinalRegex = new RegExp(
    `(^|\\s)(${tensKeys})\\s+و\\s+(${ordinalUnitKeys})(?=\\s|$)`,
    "g"
  );
  s = s.replace(compoundOrdinalRegex, (_m, prefix, tWord, uWord) => {
    const val = TENS_WORDS[tWord] + ordinalUnitMap[uWord];
    return `${prefix}${val}ام`;
  });

  // ۷. تبدیل اعداد ترتیبی ساده قبل از نام ماه‌های شمسی (مثل پانزدهم آبان -> 15ام آبان، اول فروردین -> 1ام فروردین)
  const ordinalKeys = Object.keys(ORDINAL_WORDS).join("|");
  const ordinalBeforeMonthRegex = new RegExp(
    `(^|\\s)(${ordinalKeys})(?=\\s+${MONTH_NAMES_PATTERN}(?:\\s|$))`,
    "g"
  );
  s = s.replace(ordinalBeforeMonthRegex, (_m, prefix, oWord) => {
    return `${prefix}${ORDINAL_WORDS[oWord]}ام`;
  });

  // همچنین اعداد ترتیبی مستقل (به جز «اول»، «یکم»، «دوم»، «سوم» که ممکن است در «اول ماه» یا متن عادی بیایند)
  const unambiguousOrdinals = Object.keys(ORDINAL_WORDS)
    .filter((k) => k !== "اول" && k !== "یکم" && k !== "دوم" && k !== "سوم")
    .join("|");
  const generalOrdinalRegex = new RegExp(
    `(^|\\s)(${unambiguousOrdinals})(?=\\s|$)`,
    "g"
  );
  s = s.replace(generalOrdinalRegex, (_m, prefix, oWord) => {
    return `${prefix}${ORDINAL_WORDS[oWord]}ام`;
  });

  // ۸. تبدیل اعداد مرکب ۲۱ تا ۹۹ (مثل بیست و پنج -> 25)
  const unitKeys = Object.keys(UNITS_WORDS).join("|");
  const compoundNumRegex = new RegExp(
    `(^|\\s)(${tensKeys})\\s+و\\s+(${unitKeys})(?=\\s|$)`,
    "g"
  );
  s = s.replace(compoundNumRegex, (_m, prefix, tWord, uWord) => {
    const val = TENS_WORDS[tWord] + UNITS_WORDS[uWord];
    return `${prefix}${val}`;
  });

  // ۹. تبدیل اعداد ۱۰ تا ۱۹
  const teenKeys = Object.keys(TEENS_WORDS).join("|");
  const teenRegex = new RegExp(`(^|\\s)(${teenKeys})(?=\\s|$)`, "g");
  s = s.replace(teenRegex, (_m, prefix, w) => `${prefix}${TEENS_WORDS[w]}`);

  // ۱۰. تبدیل دهگان‌ها (۲۰ تا ۹۰)
  const tensRegex = new RegExp(`(^|\\s)(${tensKeys})(?=\\s|$)`, "g");
  s = s.replace(tensRegex, (_m, prefix, w) => `${prefix}${TENS_WORDS[w]}`);

  // ۱۱. تبدیل یکان‌ها (۱ تا ۹) و «یه» در بافت شمارشی
  s = s.replace(
    /(^|\s)یه(?=\s+(?:ساعت|دقیقه|ربع|روز|هفته|ماه|سال)(?:\s|$))/g,
    "$11"
  );
  const unitRegex = new RegExp(`(^|\\s)(${unitKeys})(?=\\s|$)`, "g");
  s = s.replace(unitRegex, (_m, prefix, w) => `${prefix}${UNITS_WORDS[w]}`);

  // بازگردانی «سه ربع»
  s = s.replace(/__SE_ROB__/g, "سه ربع");

  // چسباندن پسوند «ام» به عدد (مثل «15 ام آبان» -> «15ام آبان»)
  s = s.replace(/(\d+)\s+ام(?=\s|$)/g, "$1ام");

  // ۱۲. حذف فاصله‌های اضافه
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ==================== استخراج تکرار (Recurrence) ====================

interface RecurrenceMatch {
  recurrence?: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceDays?: string[];
  matchedSpans: string[];
  weekdayTarget?: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  شنبه: 6,
  یکشنبه: 0,
  دوشنبه: 1,
  سهشنبه: 2,
  چهارشنبه: 3,
  پنجشنبه: 4,
  جمعه: 5,
};

const DAY_NAME_PATTERN = "(?:شنبه|یکشنبه|دوشنبه|سهشنبه|چهارشنبه|پنجشنبه|جمعه)";

function extractRecurrence(text: string): RecurrenceMatch {
  const matchedSpans: string[] = [];

  // ۱. «یک روز در میان» / «1 روز درمیان»
  const everyOtherDayRegex = /(?:^|\s)((?:1|یک)\s+روز\s+درمیان)(?=\s|$)/;
  const mEveryOtherDay = text.match(everyOtherDayRegex);
  if (mEveryOtherDay) {
    matchedSpans.push(mEveryOtherDay[1]);
    return {
      recurrence: "daily",
      recurrenceInterval: 2,
      matchedSpans,
    };
  }

  // ۲. «یک هفته در میان» / «1 هفته درمیان»
  const everyOtherWeekRegex = /(?:^|\s)((?:1|یک)\s+هفته\s+درمیان)(?=\s|$)/;
  const mEveryOtherWeek = text.match(everyOtherWeekRegex);
  if (mEveryOtherWeek) {
    matchedSpans.push(mEveryOtherWeek[1]);
    return {
      recurrence: "weekly",
      recurrenceInterval: 2,
      matchedSpans,
    };
  }

  // ۳. «هر N روز (یکبار)»
  const steppedDayRegex =
    /(?:^|\s)(هر\s+(\d+)\s+روز(?:\s+(?:1\s*بار|یکبار))?)(?=\s|$)/;
  const mStepDay = text.match(steppedDayRegex);
  if (mStepDay) {
    const interval = parseInt(mStepDay[2], 10);
    matchedSpans.push(mStepDay[1]);
    return {
      recurrence: "daily",
      recurrenceInterval: interval,
      matchedSpans,
    };
  }

  // ۴. «هر N هفته (یکبار)»
  const steppedWeekRegex =
    /(?:^|\s)(هر\s+(\d+)\s+هفته(?:\s+(?:1\s*بار|یکبار))?)(?=\s|$)/;
  const mStepWeek = text.match(steppedWeekRegex);
  if (mStepWeek) {
    const interval = parseInt(mStepWeek[2], 10);
    matchedSpans.push(mStepWeek[1]);
    return {
      recurrence: "weekly",
      recurrenceInterval: interval,
      matchedSpans,
    };
  }

  // ۵. «هر N ماه (یکبار)»
  const steppedMonthRegex =
    /(?:^|\s)(هر\s+(\d+)\s+ماه(?:\s+(?:1\s*بار|یکبار))?)(?=\s|$)/;
  const mStepMonth = text.match(steppedMonthRegex);
  if (mStepMonth) {
    const interval = parseInt(mStepMonth[2], 10);
    matchedSpans.push(mStepMonth[1]);
    return {
      recurrence: "monthly",
      recurrenceInterval: interval,
      matchedSpans,
    };
  }

  // ۶. «هر N سال (یکبار)»
  const steppedYearRegex =
    /(?:^|\s)(هر\s+(\d+)\s+سال(?:\s+(?:1\s*بار|یکبار))?)(?=\s|$)/;
  const mStepYear = text.match(steppedYearRegex);
  if (mStepYear) {
    const interval = parseInt(mStepYear[2], 10);
    matchedSpans.push(mStepYear[1]);
    return {
      recurrence: "yearly",
      recurrenceInterval: interval,
      matchedSpans,
    };
  }

  // ۷. تکرار چندروزه در هفته: «هر شنبه و سه‌شنبه»، «هر هفته شنبه و دوشنبه و چهارشنبه»
  const multiWeekdayRegex = new RegExp(
    `(?:^|\\s)(هر(?:\\s+هفته)?(?:\\s+روزهای|\\s+روز)?\\s+${DAY_NAME_PATTERN}(?:ها)?(?:(?:\\s+و\\s+|\\s+)(?:هر\\s+)?${DAY_NAME_PATTERN}(?:ها)?)+)(?=\\s|$)`
  );
  const mMultiWeekday = text.match(multiWeekdayRegex);
  if (mMultiWeekday) {
    const phrase = mMultiWeekday[1].trim();
    const daysFound = phrase.match(new RegExp(DAY_NAME_PATTERN, "g")) || [];
    const uniqueDays = Array.from(new Set(daysFound));
    matchedSpans.push(phrase);
    return {
      recurrence: "weekly",
      recurrenceDays: uniqueDays,
      matchedSpans,
    };
  }

  // ۸. روزهای زوج / روزهای فرد
  const evenOddDaysRegex = /(?:^|\s)((?:هر\s+)?روزهای\s+(زوج|فرد))(?=\s|$)/;
  const mEvenOdd = text.match(evenOddDaysRegex);
  if (mEvenOdd) {
    const isEven = mEvenOdd[2] === "زوج";
    matchedSpans.push(mEvenOdd[1].trim());
    return {
      recurrence: "weekly",
      recurrenceDays: isEven
        ? ["شنبه", "دوشنبه", "چهارشنبه"]
        : ["یکشنبه", "سهشنبه", "پنجشنبه"],
      matchedSpans,
    };
  }

  // ۹. تکرار تک‌روزه در هفته: «هر شنبه»، «شنبه‌ها»
  const singleWeeklyDayRegex = new RegExp(
    `(?:^|\\s)(هر\\s+(?:روز\\s+)?(${DAY_NAME_PATTERN})(?:ها)?|(${DAY_NAME_PATTERN})ها)(?=\\s|$)`
  );
  const mSingleWeekday = text.match(singleWeeklyDayRegex);
  if (mSingleWeekday) {
    const dayName = mSingleWeekday[2] || mSingleWeekday[3];
    matchedSpans.push(mSingleWeekday[1].trim());
    return {
      recurrence: "weekly",
      recurrenceDays: dayName ? [dayName] : undefined,
      weekdayTarget: dayName ? WEEKDAY_MAP[dayName] : undefined,
      matchedSpans,
    };
  }

  // ۹. تکرارهای ساده: هر سال، هر ماه، هر هفته، هر روز
  const yearlyRegex = /(?:^|\s)(هر\s*سال|سالانه|سالیانه)(?=\s|$)/;
  const monthlyRegex = /(?:^|\s)(هر\s*ماه|ماهانه|ماهیانه)(?=\s|$)/;
  const weeklyRegex = /(?:^|\s)(هر\s*هفته|هفتگی)(?=\s|$)/;
  const dailyRegex = /(?:^|\s)(هر\s*روز|روزانه|هر\s+شب|هر\s+صبح)(?=\s|$)/;

  const mYearly = text.match(yearlyRegex);
  if (mYearly) {
    matchedSpans.push(mYearly[1]);
    return { recurrence: "yearly", matchedSpans };
  }

  const mMonthly = text.match(monthlyRegex);
  if (mMonthly) {
    matchedSpans.push(mMonthly[1]);
    return { recurrence: "monthly", matchedSpans };
  }

  const mWeekly = text.match(weeklyRegex);
  if (mWeekly) {
    matchedSpans.push(mWeekly[1]);
    return { recurrence: "weekly", matchedSpans };
  }

  const mDaily = text.match(dailyRegex);
  if (mDaily) {
    matchedSpans.push(mDaily[1]);
    return { recurrence: "daily", matchedSpans };
  }

  return { matchedSpans };
}

// ==================== استخراج فاصله نسبی ساعت و دقیقه ====================

interface RelativeDateTimeResult {
  matched: boolean;
  date?: string;
  dateJalali?: string;
  time?: string;
  matchedSpans: string[];
}

/**
 * پوشش عبارات: «نیم ساعت دیگه»، «دو ساعت دیگه»، «۴۵ دقیقه دیگه»، «یک ساعت و نیم بعد»، «ده دقیقه دیگه»
 */
function extractRelativeDateTime(
  text: string,
  now: Date
): RelativeDateTimeResult {
  const matchedSpans: string[] = [];
  let totalMinutes: number | null = null;

  // ۱. «N ساعت و (نیم | ربع | سه ربع | M دقیقه) دیگه / بعد»
  const hourAndFractionRegex =
    /(?:^|\s)((\d+)\s+ساعت\s+و\s+(نیم|سه\s+ربع|(?:1\s+)?ربع|(\d+)\s*دقیقه)\s+(?:دیگه|دیگر|بعد|آینده))(?=\s|$)/;
  const mHourFrac = text.match(hourAndFractionRegex);
  if (mHourFrac) {
    const hours = parseInt(mHourFrac[2], 10);
    const sub = mHourFrac[3];
    let mins = 0;
    if (sub === "نیم") mins = 30;
    else if (sub.includes("سه ربع")) mins = 45;
    else if (sub.includes("ربع")) mins = 15;
    else if (mHourFrac[4]) mins = parseInt(mHourFrac[4], 10);

    totalMinutes = hours * 60 + mins;
    matchedSpans.push(mHourFrac[1].trim());
  }

  // ۲. «نیم ساعت دیگه / بعد»، «یک ربع دیگه»، «سه ربع دیگه»
  if (totalMinutes === null) {
    const fractionOnlyRegex =
      /(?:^|\s)((نیم\s+ساعت|سه\s+ربع(?:\s+ساعت)?|(?:1\s+)?ربع(?:\s+ساعت)?)\s+(?:دیگه|دیگر|بعد|آینده))(?=\s|$)/;
    const mFracOnly = text.match(fractionOnlyRegex);
    if (mFracOnly) {
      const kind = mFracOnly[2];
      if (kind.startsWith("نیم")) totalMinutes = 30;
      else if (kind.startsWith("سه ربع")) totalMinutes = 45;
      else totalMinutes = 15;
      matchedSpans.push(mFracOnly[1].trim());
    }
  }

  // ۳. «N ساعت دیگه / بعد»
  if (totalMinutes === null) {
    const hoursOnlyRegex =
      /(?:^|\s)((\d+)\s+ساعت\s+(?:دیگه|دیگر|بعد|آینده))(?=\s|$)/;
    const mHours = text.match(hoursOnlyRegex);
    if (mHours) {
      totalMinutes = parseInt(mHours[2], 10) * 60;
      matchedSpans.push(mHours[1].trim());
    }
  }

  // ۴. «N دقیقه دیگه / بعد»
  if (totalMinutes === null) {
    const minutesOnlyRegex =
      /(?:^|\s)((\d+)\s+دقیقه\s+(?:دیگه|دیگر|بعد|آینده))(?=\s|$)/;
    const mMins = text.match(minutesOnlyRegex);
    if (mMins) {
      totalMinutes = parseInt(mMins[2], 10);
      matchedSpans.push(mMins[1].trim());
    }
  }

  if (totalMinutes !== null) {
    const target = new Date(now.getTime() + totalMinutes * 60 * 1000);
    const { date, dateJalali } = dateToBothFormats(target);
    const time = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
    return {
      matched: true,
      date,
      dateJalali,
      time,
      matchedSpans,
    };
  }

  return { matched: false, matchedSpans };
}

// ==================== استخراج ساعت (Time) ====================

type DayPeriod = "morning" | "noon" | "afternoon" | "night" | "midnight";

interface TimeExtractionResult {
  time?: string;
  ambiguous: boolean;
  matchedSpans: string[];
  impliedDateOffset?: number;
}

function detectDayPeriod(text: string): {
  period?: DayPeriod;
  periodWord?: string;
  impliedDateOffset?: number;
} {
  const m = text.match(
    /(?:^|\s)(نیمهشب|بامداد|سحر|صبح|ظهر|بعدازظهر|عصر|امشب|دیشب|شب)(?=\s|$)/
  );
  if (!m) return {};
  const word = m[1];
  if (word === "نیمهشب") return { period: "midnight", periodWord: word };
  if (word === "صبح" || word === "بامداد" || word === "سحر")
    return { period: "morning", periodWord: word };
  if (word === "ظهر") return { period: "noon", periodWord: word };
  if (word === "بعدازظهر" || word === "عصر")
    return { period: "afternoon", periodWord: word };
  if (word === "امشب")
    return { period: "night", periodWord: word, impliedDateOffset: 0 };
  if (word === "دیشب")
    return { period: "night", periodWord: word, impliedDateOffset: -1 };
  if (word === "شب") return { period: "night", periodWord: word };
  return {};
}

function resolve24Hour(
  rawHour: number,
  minute: number,
  period?: DayPeriod
): { hour24: number; minute: number; ambiguous: boolean } {
  if (rawHour >= 13 && rawHour <= 23) {
    return { hour24: rawHour, minute, ambiguous: false };
  }
  if (rawHour === 0) {
    return { hour24: 0, minute, ambiguous: false };
  }

  if (period) {
    switch (period) {
      case "midnight":
        return {
          hour24: rawHour === 12 ? 0 : rawHour,
          minute,
          ambiguous: false,
        };
      case "morning":
        return {
          hour24: rawHour === 12 ? 0 : rawHour,
          minute,
          ambiguous: false,
        };
      case "noon":
        return {
          hour24: rawHour < 12 ? rawHour + 12 : 12,
          minute,
          ambiguous: false,
        };
      case "afternoon":
        return {
          hour24: rawHour < 12 ? rawHour + 12 : 12,
          minute,
          ambiguous: false,
        };
      case "night":
        if (rawHour === 12) return { hour24: 0, minute, ambiguous: false };
        if (rawHour >= 1 && rawHour <= 4)
          return { hour24: rawHour, minute, ambiguous: false };
        return { hour24: rawHour + 12, minute, ambiguous: false };
    }
  }

  // بدون بخش روز (مبهم): ساعت‌های ۸ تا ۱۱ -> صبح، ۱۲ -> ظهر، ۱ تا ۷ -> عصر
  if (rawHour === 12) {
    return { hour24: 12, minute, ambiguous: true };
  }
  if (rawHour >= 8 && rawHour <= 11) {
    return { hour24: rawHour, minute, ambiguous: true };
  }
  return { hour24: rawHour + 12, minute, ambiguous: true };
}

function extractTime(text: string): TimeExtractionResult {
  const matchedSpans: string[] = [];
  const periodInfo = detectDayPeriod(text);
  const period = periodInfo.period;

  const periodPattern = "(?:\\s+(?:صبح|بامداد|سحر|ظهر|بعدازظهر|عصر|شب|نیمهشب))?";

  // ۱. الگوی «X دقیقه به Y» یا «یک ربع به Y» یا «ربع به Y»
  const toHourRegex = new RegExp(
    `(?:(?:در\\s+)?ساعت\\s+)?(?:(\\d{1,2})\\s*دقیقه|(?:1\\s+)?ربع|سه\\s+ربع)\\s+به\\s+(?:ساعت\\s+)?(\\d{1,2})${periodPattern}`
  );
  const mToHour = text.match(toHourRegex);
  if (mToHour) {
    const fullMatch = mToHour[0].trim();
    let minsBefore = 15;
    if (mToHour[1]) {
      minsBefore = parseInt(mToHour[1], 10);
    } else if (fullMatch.includes("سه ربع")) {
      minsBefore = 45;
    }
    const targetHour = parseInt(mToHour[2], 10);
    if (targetHour >= 1 && targetHour <= 24 && minsBefore > 0 && minsBefore < 60) {
      let baseHour = targetHour - 1;
      if (baseHour === 0) baseHour = 12;
      const minute = 60 - minsBefore;
      const resolved = resolve24Hour(baseHour, minute, period);
      matchedSpans.push(fullMatch);
      if (periodInfo.periodWord && !fullMatch.includes(periodInfo.periodWord)) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(resolved.hour24)}:${pad2(resolved.minute)}`,
        ambiguous: resolved.ambiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۲. الگوی دیجیتال «HH:mm»
  const digitalRegex = new RegExp(
    `(?:(?:در\\s+|راس\\s+)?ساعت\\s+)?(\\d{1,2}):(\\d{2})${periodPattern}`
  );
  const mDigital = text.match(digitalRegex);
  if (mDigital) {
    const h = parseInt(mDigital[1], 10);
    const min = parseInt(mDigital[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const hasLeadingZero = mDigital[1].length === 2 && mDigital[1].startsWith("0");
      const resolved = resolve24Hour(h, min, period);
      const isAmbiguous = hasLeadingZero ? false : resolved.ambiguous;
      const finalHour = hasLeadingZero ? h : resolved.hour24;
      matchedSpans.push(mDigital[0].trim());
      if (periodInfo.periodWord && !mDigital[0].includes(periodInfo.periodWord)) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(finalHour)}:${pad2(min)}`,
        ambiguous: isAmbiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۳. الگوی کسری: «(ساعت) H و نیم / ربع / سه ربع»
  const fractionRegex = new RegExp(
    `(?:(?:در\\s+|راس\\s+)?ساعت\\s+)?(\\d{1,2})\\s+و\\s+(نیم|سه\\s+ربع|(?:1\\s+)?ربع)${periodPattern}`
  );
  const mFraction = text.match(fractionRegex);
  if (mFraction) {
    const h = parseInt(mFraction[1], 10);
    const frac = mFraction[2];
    if (h >= 1 && h <= 23) {
      let min = 30;
      if (frac === "نیم") min = 30;
      else if (frac.includes("سه ربع")) min = 45;
      else min = 15;

      const resolved = resolve24Hour(h, min, period);
      matchedSpans.push(mFraction[0].trim());
      if (periodInfo.periodWord && !mFraction[0].includes(periodInfo.periodWord)) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(resolved.hour24)}:${pad2(resolved.minute)}`,
        ambiguous: resolved.ambiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۴. الگوی «ساعت H و M دقیقه» یا «ساعت H و M»
  const hourMinWordsRegex = new RegExp(
    `(?:در\\s+|راس\\s+)?ساعت\\s+(\\d{1,2})\\s+و\\s+(\\d{1,2})(?:\\s*دقیقه)?${periodPattern}`
  );
  const mHourMin = text.match(hourMinWordsRegex);
  if (mHourMin) {
    const h = parseInt(mHourMin[1], 10);
    const min = parseInt(mHourMin[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const resolved = resolve24Hour(h, min, period);
      matchedSpans.push(mHourMin[0].trim());
      if (periodInfo.periodWord && !mHourMin[0].includes(periodInfo.periodWord)) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(resolved.hour24)}:${pad2(resolved.minute)}`,
        ambiguous: resolved.ambiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۴-ب. الگوی بازه ساعتی: «از ساعت H1 تا H2 (صبح/عصر/...)»
  const hourRangeRegex = new RegExp(
    `(?:از\\s+)?ساعت\\s+(\\d{1,2})(?::(\\d{2}))?\\s+تا\\s+(?:ساعت\\s+)?(\\d{1,2})(?::(\\d{2}))?${periodPattern}`
  );
  const mHourRange = text.match(hourRangeRegex);
  if (mHourRange) {
    const h = parseInt(mHourRange[1], 10);
    const min = mHourRange[2] ? parseInt(mHourRange[2], 10) : 0;
    if (h >= 0 && h <= 24 && min >= 0 && min <= 59) {
      const normalizedH = h === 24 ? 0 : h;
      const resolved = resolve24Hour(normalizedH, min, period);
      matchedSpans.push(mHourRange[0].trim());
      if (
        periodInfo.periodWord &&
        !mHourRange[0].includes(periodInfo.periodWord)
      ) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(resolved.hour24)}:${pad2(resolved.minute)}`,
        ambiguous: resolved.ambiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۵. الگوی «ساعت H (صبح/عصر/...)»
  const explicitHourRegex = new RegExp(
    `(?:در\\s+|راس\\s+)?ساعت\\s+(\\d{1,2})${periodPattern}`
  );
  const mExplicitHour = text.match(explicitHourRegex);
  if (mExplicitHour) {
    const h = parseInt(mExplicitHour[1], 10);
    if (h >= 0 && h <= 24) {
      const normalizedH = h === 24 ? 0 : h;
      const resolved = resolve24Hour(normalizedH, 0, period);
      matchedSpans.push(mExplicitHour[0].trim());
      if (
        periodInfo.periodWord &&
        !mExplicitHour[0].includes(periodInfo.periodWord)
      ) {
        matchedSpans.push(periodInfo.periodWord);
      }
      return {
        time: `${pad2(resolved.hour24)}:00`,
        ambiguous: resolved.ambiguous,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۶. الگوی بدون کلمه ساعت اما همراه با بخش روز: «۸ صبح»، «۵ عصر»، «۱۰ شب»
  const hourWithPeriodRegex =
    /(?:^|\s)(\d{1,2})\s+(صبح|بامداد|سحر|ظهر|بعدازظهر|عصر|شب|نیمهشب)(?=\s|$)/;
  const mHourPeriod = text.match(hourWithPeriodRegex);
  if (mHourPeriod) {
    const h = parseInt(mHourPeriod[1], 10);
    if (h >= 1 && h <= 23) {
      const resolved = resolve24Hour(h, 0, period);
      matchedSpans.push(mHourPeriod[0].trim());
      return {
        time: `${pad2(resolved.hour24)}:00`,
        ambiguous: false,
        matchedSpans,
        impliedDateOffset: periodInfo.impliedDateOffset,
      };
    }
  }

  // ۷. اشاره مستقیم به «نیمه‌شب» یا «سر ظهر» بدون عدد ساعت
  if (/(?:^|\s)نیمهشب(?=\s|$)/.test(text)) {
    matchedSpans.push("نیمهشب");
    return {
      time: "00:00",
      ambiguous: false,
      matchedSpans,
      impliedDateOffset: periodInfo.impliedDateOffset,
    };
  }
  const mNoonOnly = text.match(/(?:^|\s)(سر\s+ظهر|ظهر)(?=\s|$)/);
  if (mNoonOnly) {
    matchedSpans.push(mNoonOnly[1]);
    return {
      time: "12:00",
      ambiguous: false,
      matchedSpans,
      impliedDateOffset: periodInfo.impliedDateOffset,
    };
  }

  if (
    periodInfo.impliedDateOffset !== undefined &&
    periodInfo.periodWord &&
    !matchedSpans.includes(periodInfo.periodWord)
  ) {
    matchedSpans.push(periodInfo.periodWord);
  }

  return {
    ambiguous: false,
    matchedSpans,
    impliedDateOffset: periodInfo.impliedDateOffset,
  };
}

// ==================== استخراج تاریخ (Date) ====================

interface DateExtractionResult {
  date?: string;
  dateJalali?: string;
  ambiguousDate?: boolean;
  matchedSpans: string[];
}

function addJalaliMonths(
  jy: number,
  jm: number,
  jd: number,
  monthsToAdd: number
): [number, number, number] {
  const totalMonths = jy * 12 + (jm - 1) + monthsToAdd;
  const targetJy = Math.floor(totalMonths / 12);
  const targetJm = (totalMonths % 12) + 1;
  const maxDay = getJalaliMonthLength(targetJy, targetJm);
  const targetJd = Math.min(jd, maxDay);
  return [targetJy, targetJm, targetJd];
}

function extractDate(
  text: string,
  now: Date,
  impliedDateOffset?: number,
  recurrenceWeekday?: number,
  recurrenceDays?: string[]
): DateExtractionResult {
  const matchedSpans: string[] = [];
  const gyNow = now.getFullYear();
  const gmNow = now.getMonth() + 1;
  const gdNow = now.getDate();
  const [curJy, curJm, curJd] = gregorianToJalali(gyNow, gmNow, gdNow);

  // ۱. تاریخ عددی کامل شمسی: 1405/08/15 یا 1405-08-15
  const numericJalaliRegex =
    /(?:در\s+تاریخ\s+|تاریخ\s+|روز\s+)?(1[34]\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/;
  const mNumJalali = text.match(numericJalaliRegex);
  if (mNumJalali) {
    const jy = parseInt(mNumJalali[1], 10);
    const jm = parseInt(mNumJalali[2], 10);
    const jd = parseInt(mNumJalali[3], 10);
    if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
      matchedSpans.push(mNumJalali[0].trim());
      return {
        date: formatGregorianISO(gy, gm, gd),
        dateJalali: formatJalaliISO(jy, jm, jd),
        matchedSpans,
      };
    }
  }

  // ۱-ب. فاصله نسبی نسبت به مناسبت‌های شناخته‌شده (یلدا / نوروز): «دو روز قبل از یلدا»
  const relativeHolidayRegex =
    /(?:^|\s)((\d+)\s+روز\s+(قبل|پیش|بعد)\s+از\s+(?:شب\s+|عید\s+)?(یلدا|نوروز))(?=\s|$)/;
  const mRelHoliday = text.match(relativeHolidayRegex);
  if (mRelHoliday) {
    const daysOffset = parseInt(mRelHoliday[2], 10);
    const isBefore = mRelHoliday[3] === "قبل" || mRelHoliday[3] === "پیش";
    const holiday = mRelHoliday[4];
    const hJm = holiday === "یلدا" ? 9 : 1;
    const hJd = holiday === "یلدا" ? 30 : 1;
    const hJy = holiday === "نوروز" && curJm > 1 ? curJy + 1 : curJy;
    const [hGy, hGm, hGd] = jalaliToGregorian(hJy, hJm, hJd);
    const baseHolidayDate = new Date(hGy, hGm - 1, hGd);
    const target = addGregorianDays(
      baseHolidayDate,
      isBefore ? -daysOffset : daysOffset
    );
    matchedSpans.push(mRelHoliday[1].trim());
    return { ...dateToBothFormats(target), matchedSpans };
  }

  // ۲. عبارت‌های تقویمی ماهانه: «آخر اسفند / آخر آبان» یا «آخر ماه»، «اول ماه»، «سر ماه»
  const endOfSpecificMonthRegex = new RegExp(
    `(?:^|\\s)((?:برای\\s+|در\\s+)?(?:آخر|پایان|ته)\\s+(?:ماه\\s+)?(${MONTH_NAMES_PATTERN}))(?=\\s|$)`
  );
  const mEndSpecMonth = text.match(endOfSpecificMonthRegex);
  if (mEndSpecMonth) {
    const monthName = mEndSpecMonth[2];
    const jm = JALALI_MONTHS[monthName];
    const jd = getJalaliMonthLength(curJy, jm);
    const [gy, gm, gd] = jalaliToGregorian(curJy, jm, jd);
    matchedSpans.push(mEndSpecMonth[1].trim());
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(curJy, jm, jd),
      matchedSpans,
    };
  }

  const endOfMonthRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?(?:آخر|پایان|ته)\s+(?:همین\s+|این\s+)?(?:ماه|برج))(?=\s|$)/;
  const mEndMonth = text.match(endOfMonthRegex);
  if (mEndMonth) {
    const lastDay = getJalaliMonthLength(curJy, curJm);
    const [gy, gm, gd] = jalaliToGregorian(curJy, curJm, lastDay);
    matchedSpans.push(mEndMonth[1].trim());
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(curJy, curJm, lastDay),
      matchedSpans,
    };
  }

  const startOfNextMonthRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?(?:اول|سر|ابتدای)\s+(?:ماه|برج)(?:\s+(?:بعد|بعدی|آینده|دیگه))?)(?=\s|$)/;
  const mStartMonth = text.match(startOfNextMonthRegex);
  if (mStartMonth) {
    const nextJy = curJm === 12 ? curJy + 1 : curJy;
    const nextJm = curJm === 12 ? 1 : curJm + 1;
    const nextJd = 1;
    const [gy, gm, gd] = jalaliToGregorian(nextJy, nextJm, nextJd);
    matchedSpans.push(mStartMonth[1].trim());
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(nextJy, nextJm, nextJd),
      matchedSpans,
    };
  }

  // ۳. تاریخ صریح شمسی با نام ماه: «۱۵ آبان»، «۱۵ام آبان»، «۲۳ اردیبهشت ۱۴۰۶»
  const explicitMonthRegex = new RegExp(
    `(?:در\\s+تاریخ\\s+|تاریخ\\s+|روز\\s+)?(\\d{1,2})(?:ام|م)?\\s+(${MONTH_NAMES_PATTERN})(?:\\s+ماه)?(?:\\s+سال)?(?:\\s+(\\d{2,4}))?(?=\\s|$)`
  );
  const mExplicit = text.match(explicitMonthRegex);
  if (mExplicit) {
    const jd = parseInt(mExplicit[1], 10);
    const monthName = mExplicit[2];
    const jm = JALALI_MONTHS[monthName];
    let jy = curJy;
    if (mExplicit[3]) {
      const parsedYear = parseInt(mExplicit[3], 10);
      jy = parsedYear < 100 ? 1400 + parsedYear : parsedYear;
    }
    const maxDay = getJalaliMonthLength(jy, jm);
    if (jm && jd >= 1 && jd <= maxDay) {
      const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
      matchedSpans.push(mExplicit[0].trim());
      return {
        date: formatGregorianISO(gy, gm, gd),
        dateJalali: formatJalaliISO(jy, jm, jd),
        matchedSpans,
      };
    }
  }

  // ۴. فاصله‌های نسبی عددی: «سه روز دیگه»، «دو هفته دیگه»، «۲ ماه بعد»
  const relDaysRegex =
    /(?:^|\s)(\d+)\s+روز\s+(?:دیگه|دیگر|بعد|آینده)(?=\s|$)/;
  const mRelDays = text.match(relDaysRegex);
  if (mRelDays) {
    const n = parseInt(mRelDays[1], 10);
    const target = addGregorianDays(now, n);
    matchedSpans.push(mRelDays[0].trim());
    return { ...dateToBothFormats(target), matchedSpans };
  }

  const relWeeksRegex =
    /(?:^|\s)(\d+)\s+هفته\s+(?:دیگه|دیگر|بعد|آینده)(?=\s|$)/;
  const mRelWeeks = text.match(relWeeksRegex);
  if (mRelWeeks) {
    const n = parseInt(mRelWeeks[1], 10);
    const target = addGregorianDays(now, n * 7);
    matchedSpans.push(mRelWeeks[0].trim());
    return { ...dateToBothFormats(target), matchedSpans };
  }

  const relMonthsRegex =
    /(?:^|\s)(\d+)\s+ماه\s+(?:دیگه|دیگر|بعد|آینده)(?=\s|$)/;
  const mRelMonths = text.match(relMonthsRegex);
  if (mRelMonths) {
    const n = parseInt(mRelMonths[1], 10);
    const [tJy, tJm, tJd] = addJalaliMonths(curJy, curJm, curJd, n);
    const [gy, gm, gd] = jalaliToGregorian(tJy, tJm, tJd);
    matchedSpans.push(mRelMonths[0].trim());
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(tJy, tJm, tJd),
      matchedSpans,
    };
  }

  // ۵. عبارات نسبی ثابت: پس‌فردا، فردا، امروز، دیروز، پریروز، هفته بعد، ماه بعد، سال بعد
  if (/(?:^|\s)(?:برای\s+)?پسفردا(?=\s|$)/.test(text)) {
    const m = text.match(/(?:^|\s)((?:برای\s+)?پسفردا)(?=\s|$)/)!;
    matchedSpans.push(m[1]);
    return { ...dateToBothFormats(addGregorianDays(now, 2)), matchedSpans };
  }

  if (/(?:^|\s)(?:برای\s+)?فردا(?=\s|$)/.test(text)) {
    const m = text.match(/(?:^|\s)((?:برای\s+)?فردا)(?=\s|$)/)!;
    matchedSpans.push(m[1]);
    return { ...dateToBothFormats(addGregorianDays(now, 1)), matchedSpans };
  }

  if (/(?:^|\s)(?:برای\s+)?(?:امروز|امشب)(?=\s|$)/.test(text)) {
    const m = text.match(/(?:^|\s)((?:برای\s+)?(?:امروز|امشب))(?=\s|$)/)!;
    matchedSpans.push(m[1]);
    return { ...dateToBothFormats(addGregorianDays(now, 0)), matchedSpans };
  }

  if (/(?:^|\s)پریروز(?=\s|$)/.test(text)) {
    matchedSpans.push("پریروز");
    return { ...dateToBothFormats(addGregorianDays(now, -2)), matchedSpans };
  }

  if (/(?:^|\s)(?:دیروز|دیشب)(?=\s|$)/.test(text)) {
    const m = text.match(/(?:^|\s)(دیروز|دیشب)(?=\s|$)/)!;
    matchedSpans.push(m[1]);
    return { ...dateToBothFormats(addGregorianDays(now, -1)), matchedSpans };
  }

  const nextWeekRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?هفته\s+(?:بعد|بعدی|آینده|دیگه|دیگر))(?=\s|$)/;
  const mNextWeek = text.match(nextWeekRegex);
  if (mNextWeek && !/(?:شنبه|جمعه)\s+هفته\s+(?:بعد|آینده)/.test(text)) {
    matchedSpans.push(mNextWeek[1]);
    return { ...dateToBothFormats(addGregorianDays(now, 7)), matchedSpans };
  }

  const nextMonthRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?ماه\s+(?:بعد|بعدی|آینده|دیگه|دیگر))(?=\s|$)/;
  const mNextMonth = text.match(nextMonthRegex);
  if (mNextMonth) {
    matchedSpans.push(mNextMonth[1]);
    const [tJy, tJm, tJd] = addJalaliMonths(curJy, curJm, curJd, 1);
    const [gy, gm, gd] = jalaliToGregorian(tJy, tJm, tJd);
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(tJy, tJm, tJd),
      matchedSpans,
    };
  }

  const nextYearRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?سال\s+(?:بعد|بعدی|آینده|دیگه|دیگر))(?=\s|$)/;
  const mNextYear = text.match(nextYearRegex);
  if (mNextYear) {
    matchedSpans.push(mNextYear[1]);
    const [tJy, tJm, tJd] = addJalaliMonths(curJy, curJm, curJd, 12);
    const [gy, gm, gd] = jalaliToGregorian(tJy, tJm, tJd);
    return {
      date: formatGregorianISO(gy, gm, gd),
      dateJalali: formatJalaliISO(tJy, tJm, tJd),
      matchedSpans,
    };
  }

  // ۶. نام روزهای هفته (شنبه تا جمعه، با «این» و «بعدی / هفته بعد / آینده»)
  const weekdayRegex =
    /(?:^|\s)((?:برای\s+)?(?:روز\s+)?(این\s+)?(شنبه|یکشنبه|دوشنبه|سهشنبه|چهارشنبه|پنجشنبه|جمعه)(?:\s+(این\s+هفته|هفته\s+بعد|هفته\s+بعدی|هفته\s+آینده|بعدی|بعد|آینده|دیگه))?)(?=\s|$)/;
  const mWeekday = text.match(weekdayRegex);
  if (
    mWeekday &&
    recurrenceWeekday === undefined &&
    (!recurrenceDays || recurrenceDays.length === 0)
  ) {
    const fullPhrase = mWeekday[1].trim();
    const dayName = mWeekday[3];
    const suffixMod = mWeekday[4] || "";

    const targetJsDow = WEEKDAY_MAP[dayName];
    const currentJsDow = now.getDay();

    let diff = (targetJsDow - currentJsDow + 7) % 7;

    const curPersianDow = (currentJsDow + 1) % 7;
    const targetPersianDow = (targetJsDow + 1) % 7;

    if (
      suffixMod.includes("هفته بعد") ||
      suffixMod.includes("هفته آینده") ||
      suffixMod.includes("بعد") ||
      suffixMod.includes("آینده") ||
      suffixMod.includes("دیگه")
    ) {
      if (diff === 0) {
        diff = 7;
      } else if (targetPersianDow > curPersianDow) {
        diff += 7;
      }
    }

    matchedSpans.push(fullPhrase);
    const targetDate = addGregorianDays(now, diff);
    return { ...dateToBothFormats(targetDate), matchedSpans };
  }

  // ۷. عبارت تقویمی «آخر هفته» -> جمعه پیش‌رو (با کاهش confidence)
  const weekendRegex =
    /(?:^|\s)((?:برای\s+|در\s+)?(?:این\s+)?آخر\s+هفته)(?=\s|$)/;
  const mWeekend = text.match(weekendRegex);
  if (mWeekend) {
    const fridayJsDow = 5;
    const diff = (fridayJsDow - now.getDay() + 7) % 7;
    const target = addGregorianDays(now, diff);
    matchedSpans.push(mWeekend[1].trim());
    return {
      ...dateToBothFormats(target),
      ambiguousDate: true,
      matchedSpans,
    };
  }

  // ۸. اگر تکرار هفتگی با نام تک‌روز داشتیم (مثل «هر دوشنبه»)
  if (recurrenceWeekday !== undefined) {
    const currentJsDow = now.getDay();
    const diff = (recurrenceWeekday - currentJsDow + 7) % 7;
    const targetDate = addGregorianDays(now, diff);
    return { ...dateToBothFormats(targetDate), matchedSpans };
  }

  // ۹. اگر از بخش روز (مثل «امشب» یا «دیشب») تاریخ ضمنی استنباط شده باشد
  if (impliedDateOffset !== undefined) {
    const targetDate = addGregorianDays(now, impliedDateOffset);
    return { ...dateToBothFormats(targetDate), matchedSpans };
  }

  return { matchedSpans };
}

// ==================== تشخیص نیت (Intent) و استخراج عنوان (Title) ====================

interface IntentDetectionResult {
  intent: VoiceIntent;
  matchedCommandSpans: string[];
  keepOccasionKeywordInTitle: boolean;
}

function detectIntent(text: string): IntentDetectionResult {
  const matchedCommandSpans: string[] = [];

  // ۱. ذخیره مکان (save_place)
  const savePlacePatterns = [
    /(?:^|\s)((?:لطفا\s+)?این\s+مکان\s+(?:رو|را)\s+(?:در\s+یاد\s+)?ذخیره\s+کن(?:\s+به\s+اسم|\s+با\s+نام)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?اینجا\s+(?:رو|را)\s+یادت\s+بمونه(?:\s+به\s+اسم|\s+با\s+نام)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?اینجا\s+(?:رو|را)\s+(?:ذخیره|ثبت)\s+کن(?:\s+به\s+اسم)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?این\s+(?:مکان|لوکیشن|آدرس|نقطه)\s+(?:رو|را)\s+(?:ذخیره|ثبت)\s+کن)(?=\s|$)/,
    /(?:^|\s)((?:ذخیره|ثبت)\s+(?:این\s+)?(?:مکان|لوکیشن|آدرس))(?:\s+به\s+اسم)?(?=\s|$)/,
    /(?:^|\s)(این\s+مکان\s+یادت\s+بمونه)(?=\s|$)/,
  ];
  for (const reg of savePlacePatterns) {
    const m = text.match(reg);
    if (m) {
      matchedCommandSpans.push(m[1].trim());
      return {
        intent: "save_place",
        matchedCommandSpans,
        keepOccasionKeywordInTitle: false,
      };
    }
  }

  // ۲. ثبت مناسبت (create_occasion)
  const hasOccasionWord =
    /(?:^|\s)(تولد|سالگرد|مناسبت|جشن\s+تولد|یادبود)(?=\s|$)/.test(text);
  const isActionAboutGift =
    /(?:خرید|بخرم|سفارش|کادو|کادوی|هدیه|کیک)/.test(text) &&
    /(?:یادآوری\s+کن|یادم\s+بنداز|بهم\s+بگو)/.test(text);

  if (hasOccasionWord && !isActionAboutGift) {
    const occasionCommandHelpers = [
      /(?:^|\s)((?:رو|را)?\s*(?:به\s+عنوان\s+مناسبت\s+)?(?:ثبت\s+کن|ذخیره\s+کن|اضافه\s+کن|یادم\s+بنداز|یادآوری\s+کن|بهم\s+بگو|یادت\s+بمونه))(?=\s|$)/g,
      /(?:^|\s)(ثبت\s+مناسبت|مناسبت\s+جدید|یک\s+مناسبت|1\s+مناسبت|مناسبت)(?=\s|$)/g,
    ];
    for (const reg of occasionCommandHelpers) {
      let match: RegExpExecArray | null;
      while ((match = reg.exec(text)) !== null) {
        matchedCommandSpans.push(match[1].trim());
      }
    }
    return {
      intent: "create_occasion",
      matchedCommandSpans,
      keepOccasionKeywordInTitle: true,
    };
  }

  // ۳. ثبت ایده و یادداشت (capture_idea)
  const captureIdeaPatterns = [
    /(?:^|\s)((?:لطفا\s+)?(?:این\s+)?ایده\s+(?:رو|را)\s+(?:یادداشت|ثبت|ذخیره)\s+کن)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:یک\s+|1\s+)?ایده\s+جدید(?:\s+دارم)?(?:\s+ثبت\s+کن)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*یادداشت\s+کن(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?یادداشت\s+بردار(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)(ثبت\s+ایده|یادداشت\s+جدید|ایده\s+برای|ایده)(?=\s|$)/,
  ];
  for (const reg of captureIdeaPatterns) {
    const m = text.match(reg);
    if (m) {
      matchedCommandSpans.push(m[1].trim());
      const trailingVerb = text.match(
        /(?:^|\s)((?:رو|را)?\s*(?:یادداشت|ثبت|ذخیره)\s+کن)(?=\s|$)/
      );
      if (trailingVerb && !matchedCommandSpans.includes(trailingVerb[1].trim())) {
        matchedCommandSpans.push(trailingVerb[1].trim());
      }
      return {
        intent: "capture_idea",
        matchedCommandSpans,
        keepOccasionKeywordInTitle: false,
      };
    }
  }

  // ۴. ایجاد یادآوری (create_reminder)
  const reminderPatterns = [
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*بهم\s+یادآوری\s+کن(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*به\s+من\s+یادآوری\s+کن(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*یادآوری\s+کن(?:\s+بهم|\s+به\s+من)?(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*یادم\s+بنداز(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*یادم\s+بیار(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*بهم\s+بگو(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?(?:رو|را)?\s*به\s+من\s+بگو(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?یادم\s+باشه(?:\s+که)?)(?=\s|$)/,
    /(?:^|\s)((?:لطفا\s+)?یادت\s+نره\s+(?:بهم\s+بگی\s+)?(?:که)?)(?=\s|$)/,
  ];
  for (const reg of reminderPatterns) {
    const m = text.match(reg);
    if (m) {
      matchedCommandSpans.push(m[1].trim());
      return {
        intent: "create_reminder",
        matchedCommandSpans,
        keepOccasionKeywordInTitle: false,
      };
    }
  }

  return {
    intent: "unknown",
    matchedCommandSpans: [],
    keepOccasionKeywordInTitle: false,
  };
}

/**
 * استخراج عنوان تمیز و معنادار پس از حذف بخش‌های تاریخ، ساعت، تکرار و فعل‌های دستوری
 */
function extractCleanTitle(
  normalizedText: string,
  spansToRemove: string[],
  intent: VoiceIntent
): string | undefined {
  let working = ` ${normalizedText} `;

  const sortedSpans = [...spansToRemove]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const span of sortedSpans) {
    const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "g"), " ");
  }

  working = working.replace(/\s+/g, " ").trim();

  working = working
    .replace(
      /^(?:که|و|رو|را|در|توی|تو|برای|از|به\s+اسم|با\s+نام|به\s+عنوان|لطفا|لطفاً|:|-)+(?=\s|$)\s*/g,
      ""
    )
    .trim();

  working = working
    .replace(/^(?:بهم|به\s+من|که|و|رو|را|در|برای|لطفا|:)+(?=\s|$)\s*/g, "")
    .trim();

  working = working
    .replace(
      /\s+(?:رو|را|که|و|در|برای|هم|بهم|به\s+من|کن|بکن|ثبت\s+کن|ذخیره\s+کن|:|-)+$/g,
      ""
    )
    .trim();

  if (
    intent === "save_place" &&
    /^(?:این\s+مکان|اینجا|مکان|لوکیشن)$/.test(working)
  ) {
    return undefined;
  }

  if (!working || working.length === 0) {
    return undefined;
  }

  return working;
}

// بررسی جملات پرسشی (مثل «آب و هوا فردا چطوره؟») تا به اشتباه یادآوری فرض نشوند
function isInterrogativeSentence(rawText: string, normalizedText: string): boolean {
  if (/[?؟]/.test(rawText)) return true;
  return /(?:^|\s)(?:چطوره|چطور|چیه|چیست|چنده|کجاست|کیه|آیا|چقدر)(?=\s|$)/.test(
    normalizedText
  );
}

// ==================== تابع اصلی تحلیل دستور ====================

/**
 * تحلیل دستور متنی یا صوتی فارسی به صورت کاملاً آفلاین و مبتنی بر قواعد
 * @param text متن ورودی فارسی
 * @param now زمان مرجع برای محاسبه تاریخ و ساعت نسبی (پیش‌فرض: زمان فعلی سیستم)
 */
export function parseCommand(
  text: string,
  now: Date = new Date()
): ParsedCommand {
  const normalized = normalizeText(text);

  if (!normalized) {
    return {
      text: "",
      intent: "unknown",
      confidence: 0,
      entities: {},
    };
  }

  // ۱. استخراج الگوی تکرار (شامل گام و آرایه روزهای هفته)
  const recurrenceResult = extractRecurrence(normalized);

  // ۲. بررسی فاصله نسبی ساعت و دقیقه (مثل «نیم ساعت دیگه»، «دو ساعت دیگه»، «یک ساعت و نیم بعد»)
  const relDateTime = extractRelativeDateTime(normalized, now);

  // ۳. استخراج ساعت و تاریخ
  const timeResult = relDateTime.matched
    ? {
        time: relDateTime.time,
        ambiguous: false,
        matchedSpans: relDateTime.matchedSpans,
      }
    : extractTime(normalized);

  const dateResult = relDateTime.matched
    ? {
        date: relDateTime.date,
        dateJalali: relDateTime.dateJalali,
        ambiguousDate: false,
        matchedSpans: relDateTime.matchedSpans,
      }
    : extractDate(
        normalized,
        now,
        timeResult.impliedDateOffset,
        recurrenceResult.weekdayTarget,
        recurrenceResult.recurrenceDays
      );

  // ۴. تشخیص نیت صریح (Intent)
  const intentResult = detectIntent(normalized);

  // ۵. استخراج عنوان (Title) با حذف اجزای استخراج‌شده
  const allSpansToRemove = [
    ...recurrenceResult.matchedSpans,
    ...timeResult.matchedSpans,
    ...dateResult.matchedSpans,
    ...intentResult.matchedCommandSpans,
  ];

  const title = extractCleanTitle(
    normalized,
    allSpansToRemove,
    intentResult.intent
  );

  // ۶. ساخت شیء entities
  const entities: ParsedEntities = {};
  if (title) entities.title = title;
  if (dateResult.date) entities.date = dateResult.date;
  if (dateResult.dateJalali) entities.dateJalali = dateResult.dateJalali;
  if (timeResult.time) entities.time = timeResult.time;
  if (recurrenceResult.recurrence)
    entities.recurrence = recurrenceResult.recurrence;
  if (recurrenceResult.recurrenceInterval !== undefined)
    entities.recurrenceInterval = recurrenceResult.recurrenceInterval;
  if (
    recurrenceResult.recurrenceDays &&
    recurrenceResult.recurrenceDays.length > 0
  )
    entities.recurrenceDays = recurrenceResult.recurrenceDays;

  // ۷. تعیین نیت نهایی و محاسبه میزان اطمینان (Confidence)
  let finalIntent: VoiceIntent = intentResult.intent;
  let confidence = 0.92;

  if (finalIntent === "unknown") {
    const hasTemporal = Boolean(entities.date || entities.time);
    const isQuestion = isInterrogativeSentence(text, normalized);

    // اگر فعل یادآوری ندارد ولی تاریخ یا ساعت و یک title معنادار دارد (و جمله پرسشی نیست)
    if (hasTemporal && entities.title && !isQuestion) {
      finalIntent = "create_reminder";
      confidence = 0.6;
      if (timeResult.ambiguous || dateResult.ambiguousDate) {
        confidence = 0.55;
      }
    } else {
      confidence = hasTemporal ? 0.35 : 0.15;
    }
  } else {
    if (timeResult.ambiguous) {
      confidence -= 0.15;
    }
    if (dateResult.ambiguousDate) {
      confidence -= 0.15;
    }
    if (
      (finalIntent === "create_reminder" ||
        finalIntent === "create_occasion" ||
        finalIntent === "capture_idea") &&
      !entities.title
    ) {
      confidence -= 0.25;
    }
    if (
      finalIntent === "create_reminder" &&
      entities.title &&
      entities.date &&
      entities.time &&
      !timeResult.ambiguous &&
      !dateResult.ambiguousDate
    ) {
      confidence = 0.96;
    }
  }

  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  return {
    text: normalized,
    intent: finalIntent,
    confidence,
    entities,
  };
}
