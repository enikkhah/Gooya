import React, { useState, useEffect, useMemo } from "react";
import {
  parseCommand,
  ParsedCommand,
  VoiceIntent,
  RecurrenceType,
  gregorianToJalali,
  formatJalaliISO,
} from "./voice/voiceIntent";
import {
  runAllVoiceTests,
  TestRunResult,
  VOICE_TEST_CASES,
} from "./voice/testSuite";
import {
  Sparkles,
  Calendar,
  Clock,
  Repeat,
  Tag,
  History,
  Trash2,
  Code2,
  Copy,
  Check,
  Sun,
  Moon,
  Play,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FlaskConical,
  Home,
  ListChecks,
} from "lucide-react";

const STORAGE_THEME_KEY = "gooya_theme_v1";
const STORAGE_HISTORY_KEY = "gooya_history_v1";

interface HistoryEntry {
  id: string;
  input: string;
  timestamp: string;
  result: ParsedCommand;
}

const PERSIAN_WEEKDAYS = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنج‌شنبه",
  "جمعه",
  "شنبه",
];

const PERSIAN_MONTH_NAMES = [
  "",
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const INTENT_META: Record<
  VoiceIntent,
  { label: string; description: string; accentClass: string }
> = {
  create_reminder: {
    label: "ایجاد یادآوری",
    description: "یادآوری انجام کار در زمان مشخص",
    accentClass: "text-teal-700 dark:text-teal-400",
  },
  create_occasion: {
    label: "ثبت مناسبت",
    description: "تولد، سالگرد یا مناسبت تقویمی",
    accentClass: "text-amber-700 dark:text-amber-400",
  },
  save_place: {
    label: "ذخیره مکان",
    description: "ثبت نام مکان یا موقعیت مکانی",
    accentClass: "text-sky-700 dark:text-sky-400",
  },
  capture_idea: {
    label: "ثبت ایده و یادداشت",
    description: "ذخیره سریع ایده یا یادداشت متنی",
    accentClass: "text-indigo-700 dark:text-indigo-400",
  },
  unknown: {
    label: "نامشخص",
    description: "الگوی دستوری مشخصی تشخیص داده نشد",
    accentClass: "text-slate-500 dark:text-slate-400",
  },
};

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  daily: "روزانه",
  weekly: "هفتگی",
  monthly: "ماهانه",
  yearly: "سالانه",
};

const QUICK_SAMPLES = [
  "فردا ساعت ۵ عصر یادآوری کن دکتر برم",
  "نیم ساعت دیگه یادم بنداز چای رو بردارم",
  "پنجشنبه ساعت ۸ شب شام با دوستان",
  "هر شنبه و سه‌شنبه ساعت ۶ عصر یادم بنداز باشگاه برم",
  "۱۵ آبان تولد مریم",
  "این مکان رو ذخیره کن کافه نادری",
  "یادداشت کن طراحی رابط کاربری دارک مود",
  "سر ماه ساعت ۱۰ صبح یادآوری کن پرداخت شارژ ساختمان",
];

const DEFAULT_CUSTOM_LINES = [
  "نیم ساعت دیگه یادم بنداز چای رو بردارم",
  "فردا ساعت ۱۰ دندونپزشکی",
  "هر شنبه و سه‌شنبه ساعت ۶ عصر یادم بنداز باشگاه برم",
  "سر ماه ساعت ۹ صبح بهم بگو واریز حقوق",
  "روزهای زوج ساعت ۷ عصر یادم بنداز کلاس شنا",
].join("\n");

function toDateTimeLocalString(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatReadableJalali(
  dateJalali?: string,
  dateGregorian?: string
): string {
  if (!dateJalali) return "تعیین نشده";
  const parts = dateJalali.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return dateJalali;
  const [jy, jm, jd] = parts;
  const monthName = PERSIAN_MONTH_NAMES[jm] || "";
  let weekdayName = "";
  if (dateGregorian) {
    const [gy, gm, gd] = dateGregorian.split("-").map((n) => parseInt(n, 10));
    if (!isNaN(gy) && !isNaN(gm) && !isNaN(gd)) {
      const gDate = new Date(gy, gm - 1, gd);
      weekdayName = PERSIAN_WEEKDAYS[gDate.getDay()] + " ";
    }
  }
  return `${weekdayName}${jd} ${monthName} ${jy}`;
}

function formatRecurrenceReadable(entities: ParsedCommand["entities"]): string {
  if (!entities.recurrence) return "بدون تکرار";
  const base = RECURRENCE_LABELS[entities.recurrence] || entities.recurrence;
  const parts: string[] = [base];

  if (entities.recurrenceInterval && entities.recurrenceInterval > 1) {
    const unitMap: Record<RecurrenceType, string> = {
      daily: "روز",
      weekly: "هفته",
      monthly: "ماه",
      yearly: "سال",
    };
    parts.push(
      `(هر ${entities.recurrenceInterval} ${unitMap[entities.recurrence]} یک‌بار)`
    );
  }

  if (entities.recurrenceDays && entities.recurrenceDays.length > 0) {
    parts.push(`— روزهای: ${entities.recurrenceDays.join("، ")}`);
  }

  return parts.join(" ");
}

export default function App() {
  // ۱. مدیریت تم روشن/تیره با ذخیره امن در localStorage
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved === "dark") return true;
      if (saved === "light") return false;
    } catch {
      // نادیده گرفتن خطای دسترسی به localStorage
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, darkMode ? "dark" : "light");
    } catch {
      // نادیده گرفتن خطای دسترسی به localStorage
    }
  }, [darkMode]);

  // ۲. مدیریت تب فعال (صفحه اصلی دستیار vs صفحه تست‌ها)
  const [activeTab, setActiveTab] = useState<"home" | "tests">("home");

  // ۳. زمان مرجع («الان»)
  const [nowInput, setNowInput] = useState<string>("2026-11-03T09:30");

  const referenceDate = useMemo(() => {
    const d = new Date(nowInput);
    return isNaN(d.getTime()) ? new Date("2026-11-03T09:30") : d;
  }, [nowInput]);

  const referenceJalaliInfo = useMemo(() => {
    const [jy, jm, jd] = gregorianToJalali(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      referenceDate.getDate()
    );
    const weekday = PERSIAN_WEEKDAYS[referenceDate.getDay()];
    const monthName = PERSIAN_MONTH_NAMES[jm];
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return {
      iso: formatJalaliISO(jy, jm, jd),
      time: `${pad(referenceDate.getHours())}:${pad(
        referenceDate.getMinutes()
      )}`,
      readable: `${weekday} ${jd} ${monthName} ${jy}`,
    };
  }, [referenceDate]);

  // ۴. وضعیت تحلیلگر صفحه اصلی و تاریخچه در localStorage
  const [inputText, setInputText] = useState<string>(
    "فردا ساعت ۵ عصر یادآوری کن دکتر برم"
  );
  const [parsedResult, setParsedResult] = useState<ParsedCommand>(() =>
    parseCommand(
      "فردا ساعت ۵ عصر یادآوری کن دکتر برم",
      new Date("2026-11-03T09:30")
    )
  );
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // نادیده گرفتن خطا
    }
    return [];
  });

  const saveHistoryToStorage = (items: HistoryEntry[]) => {
    setHistory(items);
    try {
      localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(items));
    } catch {
      // نادیده گرفتن خطا
    }
  };

  const handleAnalyzeMain = (customText?: string, addToHistory = true) => {
    const targetText = (customText !== undefined ? customText : inputText).trim();
    const res = parseCommand(targetText, referenceDate);
    setParsedResult(res);

    if (addToHistory && targetText.length > 0) {
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        input: targetText,
        timestamp: `${referenceJalaliInfo.readable} · ${referenceJalaliInfo.time}`,
        result: res,
      };
      const filteredPrev = history.filter((h) => h.input !== targetText);
      const updated = [entry, ...filteredPrev].slice(0, 12);
      saveHistoryToStorage(updated);
    }
  };

  const handleClearHistory = () => {
    saveHistoryToStorage([]);
  };

  // ۵. وضعیت صفحه دوم (تست‌های من و ۹۰ تست استاندارد)
  const [customBatchText, setCustomBatchText] = useState<string>(
    DEFAULT_CUSTOM_LINES
  );
  const [expandedCustomIdx, setExpandedCustomIdx] = useState<number | null>(
    null
  );
  const [testResults, setTestResults] = useState<TestRunResult[] | null>(null);
  const [testFilter, setTestFilter] = useState<"all" | "passed" | "failed">(
    "all"
  );
  const [expandedTestId, setExpandedTestId] = useState<number | null>(null);

  const customBatchResults = useMemo(() => {
    const lines = customBatchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return lines.map((line, index) => ({
      index: index + 1,
      input: line,
      output: parseCommand(line, referenceDate),
    }));
  }, [customBatchText, referenceDate]);

  const handleNowChange = (val: string) => {
    setNowInput(val);
    const parsedDate = new Date(val);
    if (!isNaN(parsedDate.getTime())) {
      setParsedResult(parseCommand(inputText, parsedDate));
      if (testResults) {
        setTestResults(runAllVoiceTests(parsedDate));
      }
    }
  };

  const handleRunTests = () => {
    setTestResults(runAllVoiceTests(referenceDate));
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(parsedResult, null, 2)
      );
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1800);
    } catch {
      // نادیده گرفتن خطا
    }
  };

  const filteredTestResults = useMemo(() => {
    if (!testResults) return [];
    if (testFilter === "passed") return testResults.filter((r) => r.passed);
    if (testFilter === "failed") return testResults.filter((r) => !r.passed);
    return testResults;
  }, [testResults, testFilter]);

  const testStats = useMemo(() => {
    if (!testResults) return { total: 0, passed: 0, failed: 0, rate: 0 };
    const total = testResults.length;
    const passed = testResults.filter((r) => r.passed).length;
    const failed = total - passed;
    const rate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
    return { total, passed, failed, rate };
  }, [testResults]);

  const currentIntentMeta =
    INTENT_META[parsedResult.intent] || INTENT_META.unknown;

  return (
    <div
      dir="rtl"
      className="min-h-screen w-full overflow-x-hidden bg-stone-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-24 md:pb-12 transition-colors duration-150"
    >
      {/* نوار بالایی اپ (با رعایت Safe-Area برای ناچ موبایل) */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-stone-200/80 dark:border-slate-800 px-4 sm:px-6 pt-safe pb-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          {/* نام اپ: یک خط طبق قرارداد Top Bar */}
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("home");
            }}
            className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            گویا
          </a>

          {/* لینک‌های ناوبری دسکتاپ */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <button
              type="button"
              onClick={() => setActiveTab("home")}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === "home"
                  ? "text-teal-700 dark:text-teal-400 font-semibold border-b-2 border-teal-600 dark:border-teal-400"
                  : "hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              دستیار گویا
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tests")}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === "tests"
                  ? "text-teal-700 dark:text-teal-400 font-semibold border-b-2 border-teal-600 dark:border-teal-400"
                  : "hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              آزمایشگاه و تست‌ها ({VOICE_TEST_CASES.length})
            </button>
          </nav>

          {/* دکمه تغییر تم روشن / تیره */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? "تغییر به تم روشن" : "تغییر به تم تیره"}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="hidden sm:inline">تم روشن</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="hidden sm:inline">تم تیره</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* محتوای اصلی اپ */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 space-y-6">
        {/* معرفی و زیرعنوان اپ + زمان مرجع */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              گویا · دستیار فهم دستور فارسی
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              پردازش کاملاً آفلاین و بلادرنگ نیت، تاریخ شمسی، ساعت و تکرار
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>زمان مرجع: {referenceJalaliInfo.readable}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">
              {referenceJalaliInfo.time}
            </span>
          </div>
        </div>

        {activeTab === "home" ? (
          /* ==================== صفحه اول: دستیار اصلی گویا ==================== */
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* بخش ورودی دستور */}
              <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="gooya-input"
                    className="block text-sm font-semibold text-slate-800 dark:text-slate-200"
                  >
                    دستور خود را بنویسید:
                  </label>
                  <textarea
                    id="gooya-input"
                    rows={3}
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      setParsedResult(
                        parseCommand(e.target.value, referenceDate)
                      );
                    }}
                    placeholder="مثال: فردا ساعت ۵ عصر یادآوری کن دکتر برم..."
                    className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-950 p-3.5 text-sm sm:text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 dark:focus:ring-teal-500 transition-colors leading-relaxed"
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleAnalyzeMain(inputText, true)}
                    className="flex-1 sm:flex-initial min-h-[46px] px-6 py-2.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>تحلیل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setInputText("");
                      setParsedResult(parseCommand("", referenceDate));
                    }}
                    className="min-h-[46px] px-4 py-2.5 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    پاک کردن
                  </button>
                </div>

                {/* نمونه‌های لمسی سریع */}
                <div className="pt-3 border-t border-stone-100 dark:border-slate-800/80 space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    نمونه‌های آماده (لمس کنید):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_SAMPLES.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setInputText(sample);
                          handleAnalyzeMain(sample, true);
                        }}
                        className="min-h-[38px] text-xs bg-stone-100 dark:bg-slate-800/90 hover:bg-teal-50 dark:hover:bg-teal-950/60 hover:text-teal-800 dark:hover:text-teal-300 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-xl transition-colors text-right cursor-pointer"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* کارت نتیجه خوانا (به جای JSON خام) */}
              <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-stone-100 dark:border-slate-800 pb-3.5">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      نتیجه تحلیل دستور
                    </div>
                    <h2
                      className={`text-base sm:text-lg font-bold mt-0.5 ${currentIntentMeta.accentClass}`}
                    >
                      {currentIntentMeta.label}
                    </h2>
                  </div>

                  <div className="text-left">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      میزان اطمینان
                    </div>
                    <div className="font-mono text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      {Math.round(parsedResult.confidence * 100)}%
                    </div>
                  </div>
                </div>

                {/* عنوان استخراج‌شده */}
                <div className="bg-stone-50 dark:bg-slate-950/80 border border-stone-200/60 dark:border-slate-800/80 rounded-xl p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Tag className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                    <span>عنوان و موضوع (Title)</span>
                  </div>
                  <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                    {parsedResult.entities.title || "بدون عنوان مشخص"}
                  </div>
                </div>

                {/* جزئیات تاریخ، ساعت و تکرار در قالب خوانا */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* تاریخ شمسی و میلادی */}
                  <div className="bg-stone-50 dark:bg-slate-950/80 border border-stone-200/60 dark:border-slate-800/80 rounded-xl p-3.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Calendar className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      <span>تاریخ شمسی و میلادی</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatReadableJalali(
                        parsedResult.entities.dateJalali,
                        parsedResult.entities.date
                      )}
                    </div>
                    {parsedResult.entities.dateJalali && (
                      <div
                        className="text-xs font-mono text-slate-500 dark:text-slate-400"
                        dir="ltr"
                      >
                        {parsedResult.entities.dateJalali} ·{" "}
                        {parsedResult.entities.date}
                      </div>
                    )}
                  </div>

                  {/* ساعت */}
                  <div className="bg-stone-50 dark:bg-slate-950/80 border border-stone-200/60 dark:border-slate-800/80 rounded-xl p-3.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Clock className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      <span>ساعت (۲۴ ساعته)</span>
                    </div>
                    <div
                      className="text-base font-mono font-bold text-slate-900 dark:text-white"
                      dir="ltr"
                    >
                      {parsedResult.entities.time || "تعیین نشده"}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {parsedResult.entities.time
                        ? "فرمت استاندارد HH:mm"
                        : "ساعتی در دستور ذکر نشده"}
                    </div>
                  </div>
                </div>

                {/* تکرار */}
                <div className="bg-stone-50 dark:bg-slate-950/80 border border-stone-200/60 dark:border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Repeat className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      <span>الگوی تکرار</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {formatRecurrenceReadable(parsedResult.entities)}
                    </div>
                  </div>

                  <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                    {parsedResult.intent}
                  </div>
                </div>

                {/* گزینه کوچک برای دیدن JSON خام */}
                <div className="pt-2 border-t border-stone-100 dark:border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowRawJson((prev) => !prev)}
                      className="min-h-[38px] text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Code2 className="w-4 h-4" />
                      <span>
                        {showRawJson ? "بستن JSON خام" : "مشاهده JSON خام"}
                      </span>
                      {showRawJson ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {showRawJson && (
                      <button
                        type="button"
                        onClick={handleCopyJson}
                        className="min-h-[34px] px-2.5 py-1 text-xs font-medium bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        {copiedJson ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>کپی شد</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>کپی JSON</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {showRawJson && (
                    <pre
                      dir="ltr"
                      className="mt-2.5 bg-slate-950 text-emerald-300 border border-slate-800 rounded-xl p-3.5 text-xs font-mono overflow-x-auto leading-relaxed"
                    >
                      {JSON.stringify(parsedResult, null, 2)}
                    </pre>
                  )}
                </div>
              </section>
            </div>

            {/* تاریخچه چند تحلیل آخر (ذخیره‌شده در localStorage) */}
            <section className="bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    تاریخچه تحلیل‌های اخیر
                  </h2>
                </div>

                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="min-h-[36px] px-3 py-1 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>پاک کردن تاریخچه</span>
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                  هنوز دستوری در تاریخچه ذخیره نشده است. با زدن دکمه «تحلیل»، آخرین جملات شما در این بخش نگه‌داری می‌شوند.
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-slate-800">
                  {history.map((item) => {
                    const meta =
                      INTENT_META[item.result.intent] || INTENT_META.unknown;
                    const ent = item.result.entities;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setInputText(item.input);
                          setParsedResult(item.result);
                        }}
                        className="w-full py-3 px-2 hover:bg-stone-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors text-right flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="space-y-0.5">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {item.input}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className={`font-medium ${meta.accentClass}`}>
                              {meta.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>عنوان: {ent.title || "—"}</span>
                            {ent.dateJalali && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono" dir="ltr">
                                  {ent.dateJalali}
                                </span>
                              </>
                            )}
                            {ent.time && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono" dir="ltr">
                                  {ent.time}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                          {item.timestamp}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ==================== صفحه دوم: آزمایشگاه و تست‌ها ==================== */
          <div className="space-y-6">
            {/* تنظیم زمان مرجع برای تست‌ها */}
            <section className="bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-sm sm:text-base">
                    <Calendar className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    <span>تنظیم زمان مرجع تست‌ها («الان» / پارامتر now)</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    برای بررسی دقیق تست‌ها با یک تاریخ و ساعت ثابت، زمان مرجع را تنظیم کنید.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="datetime-local"
                    aria-label="انتخاب زمان مرجع"
                    value={nowInput}
                    onChange={(e) => handleNowChange(e.target.value)}
                    dir="ltr"
                    className="min-h-[44px] px-3 py-1.5 text-xs sm:text-sm font-mono bg-stone-50 dark:bg-slate-950 border border-stone-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />

                  <button
                    type="button"
                    onClick={() => handleNowChange("2026-11-03T09:30")}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    تاریخ پیش‌فرض تست (۱۲ آبان ۱۴۰۵)
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleNowChange(toDateTimeLocalString(new Date()))
                    }
                    className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>زمان فعلی سیستم</span>
                  </button>
                </div>
              </div>
            </section>

            {/* بخش «تست‌های من» (تحلیل دسته‌ای چندخطی) */}
            <section className="bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-100 dark:border-slate-800 pb-3.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      تست‌های من (تحلیل یک‌جای چند جمله)
                    </h2>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    جملات خودتان را (هر خط یکی) وارد کنید تا خروجی هر خط را یک‌جا ببینید.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setCustomBatchText(DEFAULT_CUSTOM_LINES)}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    بازنشانی نمونه
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomBatchText("")}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 rounded-xl transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>پاک کردن</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <div className="lg:col-span-5 space-y-2">
                  <label
                    htmlFor="batch-custom-input"
                    className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    جملات شما ({customBatchResults.length} خط):
                  </label>
                  <textarea
                    id="batch-custom-input"
                    rows={7}
                    value={customBatchText}
                    onChange={(e) => setCustomBatchText(e.target.value)}
                    placeholder="هر خط یک جمله فارسی بنویسید..."
                    className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-950 p-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600 leading-7"
                  />
                </div>

                <div className="lg:col-span-7">
                  {customBatchResults.length === 0 ? (
                    <div className="border border-dashed border-stone-200 dark:border-slate-800 rounded-xl p-8 text-center text-xs sm:text-sm text-slate-500">
                      حداقل یک خط وارد کنید تا خروجی نمایش داده شود.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-stone-200 dark:border-slate-800 rounded-xl">
                      <table className="w-full text-right border-collapse text-xs sm:text-sm">
                        <thead>
                          <tr className="bg-stone-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-stone-200 dark:border-slate-800">
                            <th className="py-2.5 px-3 font-semibold w-10">#</th>
                            <th className="py-2.5 px-3 font-semibold">جمله و عنوان</th>
                            <th className="py-2.5 px-3 font-semibold">نیت</th>
                            <th className="py-2.5 px-3 font-semibold">تاریخ و ساعت</th>
                            <th className="py-2.5 px-3 font-semibold">تکرار</th>
                            <th className="py-2.5 px-3 font-semibold w-12">JSON</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200 dark:divide-slate-800">
                          {customBatchResults.map((item) => {
                            const isExp = expandedCustomIdx === item.index;
                            const ent = item.output.entities;
                            return (
                              <React.Fragment key={item.index}>
                                <tr className="hover:bg-stone-50 dark:hover:bg-slate-800/40 transition-colors">
                                  <td className="py-2.5 px-3 font-mono text-slate-500">
                                    {item.index}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="font-medium text-slate-900 dark:text-white">
                                      {item.input}
                                    </div>
                                    <div className="text-[11px] text-teal-700 dark:text-teal-400 mt-0.5">
                                      عنوان: {ent.title || "—"}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-xs">
                                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                                      {item.output.intent}
                                    </div>
                                    <div className="text-[11px] text-slate-500">
                                      {item.output.confidence}
                                    </div>
                                  </td>
                                  <td
                                    className="py-2.5 px-3 font-mono text-xs"
                                    dir="ltr"
                                  >
                                    <div>
                                      {ent.dateJalali || "—"}{" "}
                                      {ent.time ? `@ ${ent.time}` : ""}
                                    </div>
                                    {ent.date && (
                                      <div className="text-[11px] text-slate-400">
                                        {ent.date}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-xs">
                                    {ent.recurrence ? (
                                      <div>
                                        <span
                                          className="text-teal-700 dark:text-teal-400 font-semibold"
                                          dir="ltr"
                                        >
                                          {ent.recurrence}
                                          {ent.recurrenceInterval
                                            ? ` (/${ent.recurrenceInterval})`
                                            : ""}
                                        </span>
                                        {ent.recurrenceDays && (
                                          <div className="text-[11px] text-slate-500">
                                            [{ent.recurrenceDays.join("، ")}]
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedCustomIdx(
                                          isExp ? null : item.index
                                        )
                                      }
                                      className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg cursor-pointer"
                                    >
                                      {isExp ? (
                                        <ChevronUp className="w-4 h-4" />
                                      ) : (
                                        <ChevronDown className="w-4 h-4" />
                                      )}
                                    </button>
                                  </td>
                                </tr>
                                {isExp && (
                                  <tr className="bg-slate-950 text-slate-100">
                                    <td colSpan={6} className="p-3">
                                      <pre
                                        dir="ltr"
                                        className="font-mono text-xs text-emerald-300 overflow-x-auto"
                                      >
                                        {JSON.stringify(item.output, null, 2)}
                                      </pre>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* جدول تست‌های خودکار استاندارد (۹۰ تست) */}
            <section className="bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-100 dark:border-slate-800 pb-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    مجموعه تست‌های استاندارد ({VOICE_TEST_CASES.length} سناریو)
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    ارزیابی خودکار تمام الگوهای رسمی، محاوره‌ای، تاریخ شمسی، ساعت و تکرار
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRunTests}
                  className="min-h-[44px] px-5 py-2.5 bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {testResults ? "اجرای مجدد تست‌ها" : "اجرای تست‌ها"}
                  </span>
                </button>
              </div>

              {!testResults ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    برای اجرای {VOICE_TEST_CASES.length} سناریوی تست و مشاهده جدول قبول/رد، دکمه زیر را لمس کنید.
                  </p>
                  <button
                    type="button"
                    onClick={handleRunTests}
                    className="min-h-[44px] px-5 py-2.5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>اجرای {VOICE_TEST_CASES.length} تست استاندارد</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-stone-50 dark:bg-slate-950 border border-stone-200/80 dark:border-slate-800 rounded-xl p-3.5">
                    <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                      <div>
                        <span className="text-slate-500">کل: </span>
                        <span className="font-mono font-bold">
                          {testStats.total}
                        </span>
                      </div>
                      <span aria-hidden="true">·</span>
                      <div className="text-emerald-700 dark:text-emerald-400 font-medium">
                        <span>قبول: </span>
                        <span className="font-mono font-bold">
                          {testStats.passed}
                        </span>
                      </div>
                      <span aria-hidden="true">·</span>
                      <div className="text-rose-700 dark:text-rose-400 font-medium">
                        <span>رد: </span>
                        <span className="font-mono font-bold">
                          {testStats.failed}
                        </span>
                      </div>
                      <span aria-hidden="true">·</span>
                      <div>
                        <span className="text-slate-500">موفقیت: </span>
                        <span className="font-mono font-bold text-teal-700 dark:text-teal-400">
                          {testStats.rate}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-stone-200/70 dark:bg-slate-800 rounded-lg self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setTestFilter("all")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          testFilter === "all"
                            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        همه ({testStats.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestFilter("passed")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          testFilter === "passed"
                            ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        قبول ({testStats.passed})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestFilter("failed")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          testFilter === "failed"
                            ? "bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        رد ({testStats.failed})
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-stone-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-right border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-stone-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-stone-200 dark:border-slate-800">
                          <th className="py-3 px-3 font-semibold w-12">#</th>
                          <th className="py-3 px-3 font-semibold w-20">وضعیت</th>
                          <th className="py-3 px-3 font-semibold min-w-[200px]">
                            جمله ورودی
                          </th>
                          <th className="py-3 px-3 font-semibold">نیت</th>
                          <th className="py-3 px-3 font-semibold">عنوان</th>
                          <th className="py-3 px-3 font-semibold">تاریخ</th>
                          <th className="py-3 px-3 font-semibold">ساعت / تکرار</th>
                          <th className="py-3 px-3 font-semibold w-14">جزئیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 dark:divide-slate-800">
                        {filteredTestResults.map((row) => {
                          const isExpanded = expandedTestId === row.testCase.id;
                          const ent = row.actual.entities;
                          return (
                            <React.Fragment key={row.testCase.id}>
                              <tr
                                className={`transition-colors ${
                                  row.passed
                                    ? "hover:bg-stone-50 dark:hover:bg-slate-800/40"
                                    : "bg-rose-50/40 dark:bg-rose-950/30"
                                }`}
                              >
                                <td className="py-2.5 px-3 font-mono text-slate-500">
                                  {row.testCase.id}
                                </td>
                                <td className="py-2.5 px-3">
                                  {row.passed ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                                      <span>قبول</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-semibold">
                                      <XCircle className="w-4 h-4 shrink-0" />
                                      <span>رد</span>
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-slate-900 dark:text-white">
                                    {row.testCase.input}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {row.testCase.category}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-xs">
                                  {row.actual.intent}
                                </td>
                                <td className="py-2.5 px-3">
                                  {ent.title || "—"}
                                </td>
                                <td
                                  className="py-2.5 px-3 font-mono text-xs"
                                  dir="ltr"
                                >
                                  {ent.dateJalali || "—"}
                                </td>
                                <td
                                  className="py-2.5 px-3 font-mono text-xs"
                                  dir="ltr"
                                >
                                  <div>{ent.time || "—"}</div>
                                  {ent.recurrence && (
                                    <div className="text-[11px] text-teal-700 dark:text-teal-400">
                                      {ent.recurrence}
                                      {ent.recurrenceInterval
                                        ? ` (/${ent.recurrenceInterval})`
                                        : ""}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedTestId(
                                        isExpanded ? null : row.testCase.id
                                      )
                                    }
                                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg cursor-pointer"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-slate-950 text-slate-100">
                                  <td colSpan={8} className="p-3.5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div className="text-slate-400 mb-1">
                                          خروجی ماژول (Actual):
                                        </div>
                                        <pre
                                          dir="ltr"
                                          className="bg-slate-900 p-3 rounded-lg font-mono text-emerald-300 overflow-x-auto"
                                        >
                                          {JSON.stringify(row.actual, null, 2)}
                                        </pre>
                                      </div>
                                      <div>
                                        <div className="text-slate-400 mb-1">
                                          خروجی مورد انتظار (Expected):
                                        </div>
                                        <pre
                                          dir="ltr"
                                          className="bg-slate-900 p-3 rounded-lg font-mono text-amber-300 overflow-x-auto"
                                        >
                                          {JSON.stringify(row.expected, null, 2)}
                                        </pre>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* نوار ناوبری پایین موبایل (با رعایت Safe-Area) */}
      <nav
        aria-label="ناوبری موبایل"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-stone-200 dark:border-slate-800 pb-safe"
      >
        <div className="grid grid-cols-2 h-15 items-center">
          <button
            type="button"
            onClick={() => setActiveTab("home")}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              activeTab === "home"
                ? "text-teal-700 dark:text-teal-400 font-semibold"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[11px]">دستیار گویا</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("tests")}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              activeTab === "tests"
                ? "text-teal-700 dark:text-teal-400 font-semibold"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <FlaskConical className="w-5 h-5" />
            <span className="text-[11px]">
              تست‌ها ({VOICE_TEST_CASES.length})
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
