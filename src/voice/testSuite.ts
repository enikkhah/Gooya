/**
 * مجموعه تست‌های استاندارد ماژول فهم دستور فارسی (۹۰ سناریوی رسمی، محاوره‌ای و مرزی)
 * کاملاً مستقل از بخش‌های بیرونی اپ
 */

import {
  ParsedCommand,
  ParsedEntities,
  VoiceIntent,
  gregorianToJalali,
  jalaliToGregorian,
  getJalaliMonthLength,
  formatGregorianISO,
  formatJalaliISO,
  parseCommand,
} from "./voiceIntent";

export interface VoiceTestCase {
  id: number;
  category: string;
  input: string;
  note?: string;
  getExpected: (now: Date) => {
    intent: VoiceIntent;
    entities: ParsedEntities;
  };
}

export interface TestRunResult {
  testCase: VoiceTestCase;
  expected: {
    intent: VoiceIntent;
    entities: ParsedEntities;
  };
  actual: ParsedCommand;
  passed: boolean;
  mismatches: string[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// توابع کمکی محاسبه تاریخ و زمان مورد انتظار بر اساس زمان مرجع (now)
function offsetDate(now: Date, days: number): { date: string; dateJalali: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  const gy = d.getFullYear();
  const gm = d.getMonth() + 1;
  const gd = d.getDate();
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(jy, jm, jd),
  };
}

function offsetMinutesDateTime(
  now: Date,
  minutes: number
): { date: string; dateJalali: string; time: string } {
  const target = new Date(now.getTime() + minutes * 60 * 1000);
  const gy = target.getFullYear();
  const gm = target.getMonth() + 1;
  const gd = target.getDate();
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(jy, jm, jd),
    time: `${pad2(target.getHours())}:${pad2(target.getMinutes())}`,
  };
}

function explicitJalali(
  now: Date,
  jm: number,
  jd: number,
  jyOverride?: number
): { date: string; dateJalali: string } {
  const [curJy] = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const jy = jyOverride ?? curJy;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(jy, jm, jd),
  };
}

function endOfCurrentJalaliMonth(now: Date): { date: string; dateJalali: string } {
  const [curJy, curJm] = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const lastDay = getJalaliMonthLength(curJy, curJm);
  const [gy, gm, gd] = jalaliToGregorian(curJy, curJm, lastDay);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(curJy, curJm, lastDay),
  };
}

function startOfNextJalaliMonth(now: Date): { date: string; dateJalali: string } {
  const [curJy, curJm] = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const nextJy = curJm === 12 ? curJy + 1 : curJy;
  const nextJm = curJm === 12 ? 1 : curJm + 1;
  const [gy, gm, gd] = jalaliToGregorian(nextJy, nextJm, 1);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(nextJy, nextJm, 1),
  };
}

function nextMonthDate(now: Date, monthsToAdd = 1): { date: string; dateJalali: string } {
  const [curJy, curJm, curJd] = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const total = curJy * 12 + (curJm - 1) + monthsToAdd;
  const tJy = Math.floor(total / 12);
  const tJm = (total % 12) + 1;
  const maxDay = getJalaliMonthLength(tJy, tJm);
  const tJd = Math.min(curJd, maxDay);
  const [gy, gm, gd] = jalaliToGregorian(tJy, tJm, tJd);
  return {
    date: formatGregorianISO(gy, gm, gd),
    dateJalali: formatJalaliISO(tJy, tJm, tJd),
  };
}

function weekdayDate(
  now: Date,
  targetJsDow: number,
  isNextModifier = false
): { date: string; dateJalali: string } {
  const curJsDow = now.getDay();
  let diff = (targetJsDow - curJsDow + 7) % 7;
  const curPersianDow = (curJsDow + 1) % 7;
  const targetPersianDow = (targetJsDow + 1) % 7;
  if (isNextModifier) {
    if (diff === 0) diff = 7;
    else if (targetPersianDow > curPersianDow) diff += 7;
  }
  return offsetDate(now, diff);
}

export const VOICE_TEST_CASES: VoiceTestCase[] = [
  // ==================== ۱. یادآوری‌های پایه و تاریخ نسبی (۱ تا ۱۲) ====================
  {
    id: 1,
    category: "یادآوری و تاریخ نسبی",
    input: "فردا ساعت ۵ بهم یادآوری کن دکتر برم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "دکتر برم",
        ...offsetDate(now, 1),
        time: "17:00",
      },
    }),
  },
  {
    id: 2,
    category: "یادآوری و تاریخ نسبی",
    input: "فردا ساعت ۵ عصر یادآوری کن دکتر برم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "دکتر برم",
        ...offsetDate(now, 1),
        time: "17:00",
      },
    }),
  },
  {
    id: 3,
    category: "یادآوری و تاریخ نسبی",
    input: "امروز ساعت ۱۷:۳۰ یادم بنداز دارو بخورم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "دارو بخورم",
        ...offsetDate(now, 0),
        time: "17:30",
      },
    }),
  },
  {
    id: 4,
    category: "یادآوری و تاریخ نسبی",
    input: "پس‌فردا ساعت نه صبح بهم بگو به بانک سر بزنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "به بانک سر بزنم",
        ...offsetDate(now, 2),
        time: "09:00",
      },
    }),
  },
  {
    id: 5,
    category: "یادآوری و تاریخ نسبی",
    input: "پس فردا ساعت ۸ صبح یادم بنداز آزمایش خون بدم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "آزمایش خون بدم",
        ...offsetDate(now, 2),
        time: "08:00",
      },
    }),
  },
  {
    id: 6,
    category: "یادآوری و تاریخ نسبی",
    input: "دیروز ساعت چهار عصر یادآوری کن فاکتورها رو بررسی کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "فاکتورها رو بررسی کنم",
        ...offsetDate(now, -1),
        time: "16:00",
      },
    }),
  },
  {
    id: 7,
    category: "یادآوری و تاریخ نسبی",
    input: "سه روز دیگه ساعت ده صبح بهم یادآوری کن اجاره خونه رو واریز کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "اجاره خونه رو واریز کنم",
        ...offsetDate(now, 3),
        time: "10:00",
      },
    }),
  },
  {
    id: 8,
    category: "یادآوری و تاریخ نسبی",
    input: "پنج روز دیگه ساعت ۶ عصر یادم بنداز بلیط قطار بگیرم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "بلیط قطار بگیرم",
        ...offsetDate(now, 5),
        time: "18:00",
      },
    }),
  },
  {
    id: 9,
    category: "یادآوری و تاریخ نسبی",
    input: "دو هفته دیگه ساعت ۱۱ صبح بهم بگو تمدید بیمه ماشین",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "تمدید بیمه ماشین",
        ...offsetDate(now, 14),
        time: "11:00",
      },
    }),
  },
  {
    id: 10,
    category: "یادآوری و تاریخ نسبی",
    input: "هفته بعد ساعت سه بعدازظهر یادآوری کن جلسه تیم فنی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه تیم فنی",
        ...offsetDate(now, 7),
        time: "15:00",
      },
    }),
  },
  {
    id: 11,
    category: "یادآوری و تاریخ نسبی",
    input: "ماه بعد ساعت ۱۰ صبح یادم بنداز قسط وام رو پرداخت کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "قسط وام رو پرداخت کنم",
        ...nextMonthDate(now, 1),
        time: "10:00",
      },
    }),
  },
  {
    id: 12,
    category: "یادآوری و تاریخ نسبی",
    input: "امشب ساعت نه بهم بگو زباله‌ها رو بذارم بیرون",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "زبالهها رو بذارم بیرون",
        ...offsetDate(now, 0),
        time: "21:00",
      },
    }),
  },

  // ==================== ۲. انواع الگوهای ساعت (۱۳ تا ۲۴) ====================
  {
    id: 13,
    category: "الگوهای ساعت و زمان",
    input: "فردا ساعت پنج و نیم عصر یادم بنداز به مادر زنگ بزنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "به مادر زنگ بزنم",
        ...offsetDate(now, 1),
        time: "17:30",
      },
    }),
  },
  {
    id: 14,
    category: "الگوهای ساعت و زمان",
    input: "فردا پنج و ربع عصر بهم بگو کلاس زبان دارم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "کلاس زبان دارم",
        ...offsetDate(now, 1),
        time: "17:15",
      },
    }),
  },
  {
    id: 15,
    category: "الگوهای ساعت و زمان",
    input: "امروز ساعت هفت و سه ربع صبح یادآوری کن صبحانه بخورم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "صبحانه بخورم",
        ...offsetDate(now, 0),
        time: "07:45",
      },
    }),
  },
  {
    id: 16,
    category: "الگوهای ساعت و زمان",
    input: "فردا ده دقیقه به شش عصر یادم بنداز لپتاپ رو خاموش کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "لپتاپ رو خاموش کنم",
        ...offsetDate(now, 1),
        time: "17:50",
      },
    }),
  },
  {
    id: 17,
    category: "الگوهای ساعت و زمان",
    input: "فردا بیست دقیقه به هشت صبح بهم بگو حرکت کنم سمت شرکت",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "حرکت کنم سمت شرکت",
        ...offsetDate(now, 1),
        time: "07:40",
      },
    }),
  },
  {
    id: 18,
    category: "الگوهای ساعت و زمان",
    input: "امروز یک ربع به ده شب یادم بنداز مسواک بزنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "مسواک بزنم",
        ...offsetDate(now, 0),
        time: "21:45",
      },
    }),
  },
  {
    id: 19,
    category: "الگوهای ساعت و زمان",
    input: "فردا ربع به هفت صبح بهم یادآوری کن بیدار شم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "بیدار شم",
        ...offsetDate(now, 1),
        time: "06:45",
      },
    }),
  },
  {
    id: 20,
    category: "الگوهای ساعت و زمان",
    input: "فردا ساعت ۲۱:۱۵ یادم بنداز سریال ببینم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "سریال ببینم",
        ...offsetDate(now, 1),
        time: "21:15",
      },
    }),
  },
  {
    id: 21,
    category: "الگوهای ساعت و زمان",
    input: "امروز ساعت چهار و بیست و پنج دقیقه عصر بهم بگو ایمیل بزنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "ایمیل بزنم",
        ...offsetDate(now, 0),
        time: "16:25",
      },
    }),
  },
  {
    id: 22,
    category: "الگوهای ساعت و زمان",
    input: "امشب نیمه‌شب یادم بنداز بکاپ سرور رو چک کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "بکاپ سرور رو چک کنم",
        ...offsetDate(now, 0),
        time: "00:00",
      },
    }),
  },
  {
    id: 23,
    category: "الگوهای ساعت و زمان",
    input: "فردا ساعت دوازده ظهر بهم یادآوری کن ناهار سفارش بدم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "ناهار سفارش بدم",
        ...offsetDate(now, 1),
        time: "12:00",
      },
    }),
  },
  {
    id: 24,
    category: "الگوهای ساعت و زمان",
    input: "فردا ساعت ۱۲ شب یادم بنداز مودم رو ریست کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "مودم رو ریست کنم",
        ...offsetDate(now, 1),
        time: "00:00",
      },
    }),
  },

  // ==================== ۳. روزهای هفته (۲۵ تا ۳۳) ====================
  {
    id: 25,
    category: "روزهای هفته",
    input: "این چهارشنبه ساعت ۱۰ صبح یادم بنداز جلسه اسپرینت",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه اسپرینت",
        ...weekdayDate(now, 3, false),
        time: "10:00",
      },
    }),
  },
  {
    id: 26,
    category: "روزهای هفته",
    input: "چهارشنبه بعدی ساعت ۱۰ صبح یادم بنداز دمو محصول",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "دمو محصول",
        ...weekdayDate(now, 3, true),
        time: "10:00",
      },
    }),
  },
  {
    id: 27,
    category: "روزهای هفته",
    input: "این پنج‌شنبه ساعت ۶ عصر بهم بگو خرید آخر هفته",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "خرید آخر هفته",
        ...weekdayDate(now, 4, false),
        time: "18:00",
      },
    }),
  },
  {
    id: 28,
    category: "روزهای هفته",
    input: "پنجشنبه بعدی ساعت هشت شب یادآوری کن مهمونی خونه خاله",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "مهمونی خونه خاله",
        ...weekdayDate(now, 4, true),
        time: "20:00",
      },
    }),
  },
  {
    id: 29,
    category: "روزهای هفته",
    input: "جمعه ساعت ۷ صبح بهم بگو کوهنوردی توچال",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "کوهنوردی توچال",
        ...weekdayDate(now, 5, false),
        time: "07:00",
      },
    }),
  },
  {
    id: 30,
    category: "روزهای هفته",
    input: "شنبه آینده ساعت ۹ صبح یادم بنداز کارهای بانکی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "کارهای بانکی",
        ...weekdayDate(now, 6, true),
        time: "09:00",
      },
    }),
  },
  {
    id: 31,
    category: "روزهای هفته",
    input: "یک‌شنبه ساعت چهار عصر بهم یادآوری کن کلاس پیانو",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "کلاس پیانو",
        ...weekdayDate(now, 0, false),
        time: "16:00",
      },
    }),
  },
  {
    id: 32,
    category: "روزهای هفته",
    input: "دوشنبه بعدی ساعت یازده صبح یادم بنداز تماس با پشتیبانی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "تماس با پشتیبانی",
        ...weekdayDate(now, 1, true),
        time: "11:00",
      },
    }),
  },
  {
    id: 33,
    category: "روزهای هفته",
    input: "سه‌شنبه بعدی ساعت سه عصر بهم بگو تحویل پروژه",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "تحویل پروژه",
        ...weekdayDate(now, 2, true),
        time: "15:00",
      },
    }),
  },

  // ==================== ۴. تاریخ صریح شمسی (۳۴ تا ۴۰) ====================
  {
    id: 34,
    category: "تاریخ صریح شمسی",
    input: "۱۵ آبان ساعت ۹ صبح یادآوری کن تمدید دامنه سایت",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "تمدید دامنه سایت",
        ...explicitJalali(now, 8, 15),
        time: "09:00",
      },
    }),
  },
  {
    id: 35,
    category: "تاریخ صریح شمسی",
    input: "۱۵ام آبان ساعت ۱۸:۰۰ بهم بگو جلسه هیئت مدیره",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه هییت مدیره",
        ...explicitJalali(now, 8, 15),
        time: "18:00",
      },
    }),
  },
  {
    id: 36,
    category: "تاریخ صریح شمسی",
    input: "پانزدهم آبان ساعت ده صبح یادم بنداز ارسال لیست بیمه",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "ارسال لیست بیمه",
        ...explicitJalali(now, 8, 15),
        time: "10:00",
      },
    }),
  },
  {
    id: 37,
    category: "تاریخ صریح شمسی",
    input: "اول آذر ساعت ۸ صبح بهم یادآوری کن شروع دوره جدید",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "شروع دوره جدید",
        ...explicitJalali(now, 9, 1),
        time: "08:00",
      },
    }),
  },
  {
    id: 38,
    category: "تاریخ صریح شمسی",
    input: "بیست و پنجم دی ساعت ۱۴:۳۰ یادم بنداز نوبت چشم‌پزشکی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "نوبت چشمپزشکی",
        ...explicitJalali(now, 10, 25),
        time: "14:30",
      },
    }),
  },
  {
    id: 39,
    category: "تاریخ صریح شمسی",
    input: "۱۰ بهمن ساعت ۶ عصر بهم بگو بلیط تئاتر",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "بلیط تیاتر",
        ...explicitJalali(now, 11, 10),
        time: "18:00",
      },
    }),
  },
  {
    id: 40,
    category: "تاریخ صریح شمسی",
    input: "۲۸ اسفند ساعت ۱۱ صبح یادآوری کن خرید عید",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "خرید عید",
        ...explicitJalali(now, 12, 28),
        time: "11:00",
      },
    }),
  },

  // ==================== ۵. مناسبت‌ها (۴۱ تا ۴۶) ====================
  {
    id: 41,
    category: "ثبت مناسبت",
    input: "۱۵ آبان تولد مریم",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "تولد مریم",
        ...explicitJalali(now, 8, 15),
      },
    }),
  },
  {
    id: 42,
    category: "ثبت مناسبت",
    input: "تولد علی ۲۳ اردیبهشت هر سال یادم بنداز",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "تولد علی",
        ...explicitJalali(now, 2, 23),
        recurrence: "yearly",
      },
    }),
  },
  {
    id: 43,
    category: "ثبت مناسبت",
    input: "سالگرد ازدواجمون ۵ مهر هر سال",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "سالگرد ازدواجمون",
        ...explicitJalali(now, 7, 5),
        recurrence: "yearly",
      },
    }),
  },
  {
    id: 44,
    category: "ثبت مناسبت",
    input: "مناسبت روز مادر ۲۰ بهمن رو ثبت کن",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "روز مادر",
        ...explicitJalali(now, 11, 20),
      },
    }),
  },
  {
    id: 45,
    category: "ثبت مناسبت",
    input: "پانزدهم خرداد تولد بابا ساعت ۱۰ صبح یادم بنداز",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "تولد بابا",
        ...explicitJalali(now, 3, 15),
        time: "10:00",
      },
    }),
  },
  {
    id: 46,
    category: "ثبت مناسبت",
    input: "سالگرد تاسیس شرکت ۱۲ شهریور",
    getExpected: (now) => ({
      intent: "create_occasion",
      entities: {
        title: "سالگرد تاسیس شرکت",
        ...explicitJalali(now, 6, 12),
      },
    }),
  },

  // ==================== ۶. ذخیره مکان (۴۷ تا ۵۱) ====================
  {
    id: 47,
    category: "ذخیره مکان",
    input: "این مکان رو ذخیره کن کافه نادری",
    getExpected: () => ({
      intent: "save_place",
      entities: {
        title: "کافه نادری",
      },
    }),
  },
  {
    id: 48,
    category: "ذخیره مکان",
    input: "اینجا رو یادت بمونه رستوران البرز",
    getExpected: () => ({
      intent: "save_place",
      entities: {
        title: "رستوران البرز",
      },
    }),
  },
  {
    id: 49,
    category: "ذخیره مکان",
    input: "این مکان رو ذخیره کن به اسم کتابفروشی چشمه",
    getExpected: () => ({
      intent: "save_place",
      entities: {
        title: "کتابفروشی چشمه",
      },
    }),
  },
  {
    id: 50,
    category: "ذخیره مکان",
    input: "پمپ بنزین نیاوران این مکان رو ذخیره کن",
    getExpected: () => ({
      intent: "save_place",
      entities: {
        title: "پمپ بنزین نیاوران",
      },
    }),
  },
  {
    id: 51,
    category: "ذخیره مکان",
    input: "اینجا رو یادت بمونه",
    getExpected: () => ({
      intent: "save_place",
      entities: {},
    }),
  },

  // ==================== ۷. ثبت ایده و یادداشت (۵۲ تا ۵۵) ====================
  {
    id: 52,
    category: "ثبت ایده و یادداشت",
    input: "یادداشت کن طراحی رابط کاربری دارک مود",
    getExpected: () => ({
      intent: "capture_idea",
      entities: {
        title: "طراحی رابط کاربری دارک مود",
      },
    }),
  },
  {
    id: 53,
    category: "ثبت ایده و یادداشت",
    input: "ایده ساخت پادکست فناوری به زبان ساده",
    getExpected: () => ({
      intent: "capture_idea",
      entities: {
        title: "ساخت پادکست فناوری به زبان ساده",
      },
    }),
  },
  {
    id: 54,
    category: "ثبت ایده و یادداشت",
    input: "این ایده رو ثبت کن اضافه کردن خروجی اکسل به گزارش‌ها",
    getExpected: () => ({
      intent: "capture_idea",
      entities: {
        title: "اضافه کردن خروجی اکسل به گزارشها",
      },
    }),
  },
  {
    id: 55,
    category: "ثبت ایده و یادداشت",
    input: "یادداشت کن که رمز وایفای مهمان رو عوض کنم",
    getExpected: () => ({
      intent: "capture_idea",
      entities: {
        title: "رمز وایفای مهمان رو عوض کنم",
      },
    }),
  },

  // ==================== ۸. الگوهای تکرار پایه (۵۶ تا ۵۹) ====================
  {
    id: 56,
    category: "تکرار (Recurrence)",
    input: "هر روز ساعت ۸ صبح یادم بنداز قرص ویتامین بخورم",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "قرص ویتامین بخورم",
        time: "08:00",
        recurrence: "daily",
      },
    }),
  },
  {
    id: 57,
    category: "تکرار (Recurrence)",
    input: "هر هفته ساعت ۶ عصر بهم بگو گیاهان آپارتمانی رو آب بدم",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "گیاهان آپارتمانی رو آب بدم",
        time: "18:00",
        recurrence: "weekly",
      },
    }),
  },
  {
    id: 58,
    category: "تکرار (Recurrence)",
    input: "هر ماه اول فروردین ساعت ۹ صبح یادآوری کن حسابرسی مالی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "حسابرسی مالی",
        ...explicitJalali(now, 1, 1),
        time: "09:00",
        recurrence: "monthly",
      },
    }),
  },
  {
    id: 59,
    category: "تکرار (Recurrence)",
    input: "هر سال ۱۰ مهر ساعت ۸ صبح بهم یادآوری کن چکاپ کامل پزشکی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "چکاپ کامل پزشکی",
        ...explicitJalali(now, 7, 10),
        time: "08:00",
        recurrence: "yearly",
      },
    }),
  },

  // ==================== ۹. حروف عربی و پرسش‌های نامشخص (۶۰ تا ۶۱) ====================
  {
    id: 60,
    category: "نرمال‌سازی عربی و Unknown",
    input: "فردا ساعت ١٦:٤٥ يادم بنداز كتاب‌هاي كتابخانه رو پس بدم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "کتابهای کتابخانه رو پس بدم",
        ...offsetDate(now, 1),
        time: "16:45",
      },
    }),
  },
  {
    id: 61,
    category: "نرمال‌سازی عربی و Unknown",
    input: "وضعیت آب و هوای تهران فردا چطوره؟",
    getExpected: (now) => ({
      intent: "unknown",
      entities: {
        title: "وضعیت آب و هوای تهران چطوره",
        ...offsetDate(now, 1),
      },
    }),
  },

  // ==================== ۱۰. فاصله نسبی ساعت و دقیقه (۶۲ و ۶۶ تا ۷۲) ====================
  {
    id: 62,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "دو ساعت دیگه یادم بنداز زیر غذا رو خاموش کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "زیر غذا رو خاموش کنم",
        ...offsetMinutesDateTime(now, 120),
      },
    }),
  },
  {
    id: 63,
    category: "یادآوری بدون فعل دستوری (Intent پیش‌فرض)",
    input: "فردا ساعت ۹ صبح جلسه با مدیر محصول",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه با مدیر محصول",
        ...offsetDate(now, 1),
        time: "09:00",
      },
    }),
  },
  {
    id: 64,
    category: "عبارت‌های تقویمی",
    input: "آخر هفته ساعت ۱۰ صبح بهم بگو ماشین رو ببرم کارواش",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "ماشین رو ببرم کارواش",
        ...weekdayDate(now, 5, false),
        time: "10:00",
      },
    }),
  },
  {
    id: 65,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "هر سه روز یکبار ساعت ۸ شب یادم بنداز به گل‌ها کود بدم",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "به گلها کود بدم",
        time: "20:00",
        recurrence: "daily",
        recurrenceInterval: 3,
      },
    }),
  },
  {
    id: 66,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "نیم ساعت دیگه یادم بنداز چای رو بردارم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "چای رو بردارم",
        ...offsetMinutesDateTime(now, 30),
      },
    }),
  },
  {
    id: 67,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "۴۵ دقیقه دیگه بهم بگو لباس‌ها رو از لباسشویی دربیارم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "لباسها رو از لباسشویی دربیارم",
        ...offsetMinutesDateTime(now, 45),
      },
    }),
  },
  {
    id: 68,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "یک ساعت و نیم بعد یادآوری کن به شرکت زنگ بزنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "به شرکت زنگ بزنم",
        ...offsetMinutesDateTime(now, 90),
      },
    }),
  },
  {
    id: 69,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "ده دقیقه دیگه یادم بنداز فر رو خاموش کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "فر رو خاموش کنم",
        ...offsetMinutesDateTime(now, 10),
      },
    }),
  },
  {
    id: 70,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "سه ربع دیگه بهم بگو قرص آنتی‌بیوتیک بخورم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "قرص آنتیبیوتیک بخورم",
        ...offsetMinutesDateTime(now, 45),
      },
    }),
  },
  {
    id: 71,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "شانزده ساعت دیگه یادم بنداز سرور رو ریستارت کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "سرور رو ریستارت کنم",
        ...offsetMinutesDateTime(now, 16 * 60),
      },
    }),
  },
  {
    id: 72,
    category: "فاصله نسبی ساعت و دقیقه",
    input: "دو ساعت و بیست دقیقه بعد بهم یادآوری کن نتیجه آزمایش رو چک کنم",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "نتیجه آزمایش رو چک کنم",
        ...offsetMinutesDateTime(now, 140),
      },
    }),
  },

  // ==================== ۱۱. نیت پیش‌فرض بدون فعل یادآوری (۷۳ تا ۷۷) ====================
  {
    id: 73,
    category: "یادآوری بدون فعل دستوری (Intent پیش‌فرض)",
    input: "فردا ساعت ۱۰ دندونپزشکی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "دندونپزشکی",
        ...offsetDate(now, 1),
        time: "10:00",
      },
    }),
  },
  {
    id: 74,
    category: "یادآوری بدون فعل دستوری (Intent پیش‌فرض)",
    input: "پس‌فردا ساعت ۱۶:۰۰ مصاحبه فنی",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "مصاحبه فنی",
        ...offsetDate(now, 2),
        time: "16:00",
      },
    }),
  },
  {
    id: 75,
    category: "یادآوری بدون فعل دستوری (Intent پیش‌فرض)",
    input: "پنجشنبه ساعت ۸ شب شام با دوستان",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "شام با دوستان",
        ...weekdayDate(now, 4, false),
        time: "20:00",
      },
    }),
  },
  {
    id: 76,
    category: "یادآوری بدون فعل دستوری (Intent پیش‌فرض)",
    input: "ساعت ۷ صبح پیاده‌روی در پارک",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "پیادهروی در پارک",
        time: "07:00",
      },
    }),
  },
  {
    id: 77,
    category: "نرمال‌سازی عربی و Unknown",
    input: "خرید نان و پنیر و گردو",
    getExpected: () => ({
      intent: "unknown",
      entities: {
        title: "خرید نان و پنیر و گردو",
      },
    }),
  },

  // ==================== ۱۲. تکرار با گام و چندروزه (۷۸ تا ۸۲) ====================
  {
    id: 78,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "یک روز در میان ساعت ۷ صبح یادم بنداز بدوم",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "بدوم",
        time: "07:00",
        recurrence: "daily",
        recurrenceInterval: 2,
      },
    }),
  },
  {
    id: 79,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "هر دو هفته یکبار ساعت ۱۱ صبح بهم بگو جلسه رترو",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه رترو",
        time: "11:00",
        recurrence: "weekly",
        recurrenceInterval: 2,
      },
    }),
  },
  {
    id: 80,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "هر شنبه و سه‌شنبه ساعت ۶ عصر یادم بنداز باشگاه برم",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "باشگاه برم",
        time: "18:00",
        recurrence: "weekly",
        recurrenceDays: ["شنبه", "سهشنبه"],
      },
    }),
  },
  {
    id: 81,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "هر یکشنبه و چهارشنبه ساعت ۹ شب بهم بگو کلاس آنلاین زبان",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "کلاس آنلاین زبان",
        time: "21:00",
        recurrence: "weekly",
        recurrenceDays: ["یکشنبه", "چهارشنبه"],
      },
    }),
  },
  {
    id: 82,
    category: "تکرار با گام (Stepped Recurrence)",
    input: "هر سه ماه یکبار ساعت ۱۰ صبح یادآوری کن تعویض فیلتر تصفیه آب",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "تعویض فیلتر تصفیه آب",
        time: "10:00",
        recurrence: "monthly",
        recurrenceInterval: 3,
      },
    }),
  },

  // ==================== ۱۳. عبارت‌های تقویمی ماهانه (۸۳ تا ۸۷) ====================
  {
    id: 83,
    category: "عبارت‌های تقویمی",
    input: "آخر ماه ساعت ۱۲ ظهر یادم بنداز تسویه حساب تنخواه",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "تسویه حساب تنخواه",
        ...endOfCurrentJalaliMonth(now),
        time: "12:00",
      },
    }),
  },
  {
    id: 84,
    category: "عبارت‌های تقویمی",
    input: "اول ماه ساعت ۹ صبح بهم بگو واریز حقوق",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "واریز حقوق",
        ...startOfNextJalaliMonth(now),
        time: "09:00",
      },
    }),
  },
  {
    id: 85,
    category: "عبارت‌های تقویمی",
    input: "سر ماه ساعت ۱۰ صبح یادآوری کن پرداخت شارژ ساختمان",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "پرداخت شارژ ساختمان",
        ...startOfNextJalaliMonth(now),
        time: "10:00",
      },
    }),
  },
  {
    id: 86,
    category: "عبارت‌های تقویمی",
    input: "آخر اسفند ساعت ۵ عصر بهم بگو خانه تکانی",
    getExpected: (now) => {
      const [curJy] = gregorianToJalali(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate()
      );
      const len = getJalaliMonthLength(curJy, 12);
      return {
        intent: "create_reminder",
        entities: {
          title: "خانه تکانی",
          ...explicitJalali(now, 12, len),
          time: "17:00",
        },
      };
    },
  },
  {
    id: 87,
    category: "عبارت‌های تقویمی",
    input: "این آخر هفته ساعت ۶ عصر قرار کافه با سارا",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "قرار کافه با سارا",
        ...weekdayDate(now, 5, false),
        time: "18:00",
      },
    }),
  },

  // ==================== ۱۴. تست‌های مرزی پیشرفته (۸۸ تا ۹۰) ====================
  {
    id: 88,
    category: "الگوهای مرزی (بازه ساعتی)",
    input: "فردا از ساعت ۲ تا ۴ عصر یادم بنداز جلسه بررسی معماری",
    note: "ماژول فقط یک فیلد ساعت (time) دارد و عبارت «از ساعت ۲ تا ۴» به طور کامل از عنوان پاک نمی‌شود",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "جلسه بررسی معماری",
        ...offsetDate(now, 1),
        time: "14:00",
      },
    }),
  },
  {
    id: 89,
    category: "الگوهای مرزی (روزهای زوج/فرد)",
    input: "روزهای زوج ساعت ۷ عصر یادم بنداز کلاس شنا",
    note: "اصطلاح «روزهای زوج» (شنبه، دوشنبه، چهارشنبه) هنوز به آرایه recurrenceDays نگاشت نشده است",
    getExpected: () => ({
      intent: "create_reminder",
      entities: {
        title: "کلاس شنا",
        time: "19:00",
        recurrence: "weekly",
        recurrenceDays: ["شنبه", "دوشنبه", "چهارشنبه"],
      },
    }),
  },
  {
    id: 90,
    category: "الگوهای مرزی (تاریخ نسبی نسبت به مناسبت دیگر)",
    input: "دو روز قبل از یلدا ساعت ۵ عصر بهم بگو خرید آجیل",
    note: "محاسبه تاریخ نسبت به یک مناسبت نام‌گذاری‌شده («دو روز قبل از یلدا») پشتیبانی نمی‌شود",
    getExpected: (now) => ({
      intent: "create_reminder",
      entities: {
        title: "خرید آجیل",
        ...explicitJalali(now, 9, 28),
        time: "17:00",
      },
    }),
  },
];

/**
 * اجرای تمام تست‌ها با تاریخ مرجع مشخص و مقایسه با خروجی مورد انتظار
 */
export function runAllVoiceTests(now: Date = new Date()): TestRunResult[] {
  return VOICE_TEST_CASES.map((tc) => {
    const expected = tc.getExpected(now);
    const actual = parseCommand(tc.input, now);
    const mismatches: string[] = [];

    if (actual.intent !== expected.intent) {
      mismatches.push(`intent: «${actual.intent}» ≠ «${expected.intent}»`);
    }

    const scalarKeys: (keyof Omit<ParsedEntities, "recurrenceDays">)[] = [
      "title",
      "date",
      "dateJalali",
      "time",
      "recurrence",
      "recurrenceInterval",
    ];

    for (const k of scalarKeys) {
      const expVal = expected.entities[k];
      const actVal = actual.entities[k];
      if (expVal !== actVal) {
        mismatches.push(`${k}: «${actVal ?? "—"}» ≠ «${expVal ?? "—"}»`);
      }
    }

    const expDays = expected.entities.recurrenceDays;
    const actDays = actual.entities.recurrenceDays;
    if (expDays || actDays) {
      const expStr = expDays ? expDays.join(",") : "—";
      const actStr = actDays ? actDays.join(",") : "—";
      if (expStr !== actStr) {
        mismatches.push(`recurrenceDays: «[${actStr}]» ≠ «[${expStr}]»`);
      }
    }

    return {
      testCase: tc,
      expected,
      actual,
      passed: mismatches.length === 0,
      mismatches,
    };
  });
}
