/**
 * ماژول مستقل دریافت متن از گفتار فارسی (ASR)
 * بدون وابستگی خارجی — سازگار با:
 * ۱) پلاگین بومی Capacitor در اندروید و iOS (@capacitor-community/speech-recognition)
 * ۲) استاندارد Web Speech API در مرورگرها (SpeechRecognition / webkitSpeechRecognition)
 *
 * ویژگی‌ها:
 * - تحمل مکث‌های عادی بین کلمات و جملات (پیش‌فرض: ۵.۵ ثانیه مهلت سکوت پس از صحبت و ۱۲ ثانیه مهلت شروع)
 * - ادامه هوشمند ضبط در صورت قطع زودهنگام مرورگر در میانه صحبت (فقط در صورتی که در قطعه فعلی صحبتی شده باشد تا حلقه قطع و وصل در سکوت رخ ندهد)
 * - حذف پیشوندهای تکراری تجمعی کروم اندروید (Cumulative Prefix Deduplication)
 */

export interface VoiceCaptureOptions {
  /** زبان تشخیص گفتار (پیش‌فرض: fa-IR) */
  lang?: string;
  /** دریافت لحظه‌ای متن در حین صحبت کردن کاربر */
  onInterimResult?: (transcript: string) => void;
  /** تغییر وضعیت فعال بودن میکروفون */
  onListeningChange?: (listening: boolean) => void;
  /** سیگنال برای توقف دستی ضبط توسط کاربر */
  signal?: AbortSignal;
  /** مهلت سکوت پس از صحبت به میلی‌ثانیه برای لحاظ کردن مکث‌های عادی (پیش‌فرض: ۵۵۰۰ میلی‌ثانیه) */
  postSpeechSilenceMs?: number;
  /** مهلت اولیه شروع صحبت به میلی‌ثانیه (پیش‌فرض: ۱۲۰۰۰ میلی‌ثانیه) */
  initialSilenceMs?: number;
}

interface CapacitorSpeechPluginLike {
  available: () => Promise<{ available: boolean }>;
  checkPermissions: () => Promise<{ speechRecognition: string }>;
  requestPermissions: () => Promise<{ speechRecognition: string }>;
  start: (options?: {
    language?: string;
    maxResults?: number;
    prompt?: string;
    popup?: boolean;
    partialResults?: boolean;
  }) => Promise<{ matches?: string[] } | void>;
  stop: () => Promise<void>;
  addListener: (
    eventName: string,
    listenerFunc: (data: any) => void
  ) => Promise<{ remove: () => Promise<void> }>;
  removeAllListeners: () => Promise<void>;
}

/**
 * نرمال‌سازی سبک برای مقایسه و حذف تکرارهای تجمعی موتور تشخیص گفتار
 */
function normalizeForSpeechCompare(str: string): string {
  return (str || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ادغام هوشمند دو قطعه متن گفتار و جلوگیری از تکرار تجمعی کلمات در کروم اندروید
 */
export function mergeCumulativeSpeech(acc: string, next: string): string {
  const cleanAcc = (acc || "").replace(/\s+/g, " ").trim();
  const cleanNext = (next || "").replace(/\s+/g, " ").trim();

  if (!cleanNext) return cleanAcc;
  if (!cleanAcc) return cleanNext;

  const normAcc = normalizeForSpeechCompare(cleanAcc);
  const normNext = normalizeForSpeechCompare(cleanNext);

  if (normNext === normAcc) {
    return cleanNext;
  }

  // ۱. اگر قطعه جدید ادامه تجمعی قطعه قبلی است (حالت رایج کروم اندروید)
  if (normNext.startsWith(normAcc)) {
    return cleanNext;
  }

  // ۲. اگر قطعه جدید زیرمجموعه ابتدایی یا انتهایی قطعه قبلی است
  if (normAcc.startsWith(normNext) || normAcc.endsWith(normNext)) {
    return cleanAcc;
  }

  const accWords = normAcc.split(" ");
  const nextWords = normNext.split(" ");
  const rawNextWords = cleanNext.split(" ");

  // ۳. اگر هر دو با یک کلمه یکسان شروع شده‌اند و قطعه جدید نسخه اصلاح‌شده/کامل‌تر همان جمله است
  if (
    accWords.length > 0 &&
    nextWords.length > 0 &&
    accWords[0] === nextWords[0]
  ) {
    if (
      nextWords.length >= accWords.length ||
      (accWords.length >= 2 &&
        nextWords.length >= 2 &&
        accWords[1] === nextWords[1])
    ) {
      return cleanNext;
    }
  }

  // ۴. بررسی هم‌پوشانی انتهای جمله قبلی با ابتدای جمله جدید (Suffix-Prefix Overlap)
  const maxOverlap = Math.min(accWords.length, nextWords.length);
  for (let k = maxOverlap; k >= 1; k--) {
    const accSuffix = accWords.slice(accWords.length - k).join(" ");
    const nextPrefix = nextWords.slice(0, k).join(" ");
    if (accSuffix === nextPrefix) {
      const remainder = rawNextWords.slice(k).join(" ");
      return remainder ? `${cleanAcc} ${remainder}`.trim() : cleanAcc;
    }
  }

  return `${cleanAcc} ${cleanNext}`.trim();
}

/**
 * پاک‌سازی نهایی در صورتی که خود موتور گفتار در یک رشته واحد تکرار تجمعی تولید کرده باشد
 */
export function collapseRepeatedPrefixes(text: string): string {
  const words = (text || "").replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= 2) return text.trim();

  const resultWords: string[] = [];
  let i = 0;

  while (i < words.length) {
    let jumped = false;
    const maxLen = Math.min(10, words.length - i);
    for (let len = maxLen; len >= 1; len--) {
      if (i + len * 2 <= words.length) {
        const chunk1 = normalizeForSpeechCompare(
          words.slice(i, i + len).join(" ")
        );
        const chunk2 = normalizeForSpeechCompare(
          words.slice(i + len, i + len * 2).join(" ")
        );
        if (chunk1 && chunk1 === chunk2) {
          i += len;
          jumped = true;
          break;
        }
      }
    }
    if (!jumped) {
      resultWords.push(words[i]);
      i++;
    }
  }

  return resultWords.join(" ").trim();
}

function getCapacitorNativeSpeechPlugin(): CapacitorSpeechPluginLike | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const cap = w.Capacitor;
  if (
    !cap ||
    typeof cap.isNativePlatform !== "function" ||
    !cap.isNativePlatform()
  ) {
    return null;
  }
  return cap.Plugins?.SpeechRecognition || null;
}

function getWebSpeechRecognitionConstructor(): any | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * بررسی پشتیبانی محیط فعلی (اپ اندروید یا مرورگر) از تشخیص گفتار
 */
export function isVoiceRecognitionSupported(): boolean {
  if (getCapacitorNativeSpeechPlugin()) return true;
  if (getWebSpeechRecognitionConstructor()) return true;
  return false;
}

/**
 * دریافت متن از صدای کاربر به زبان فارسی
 */
export async function getTranscript(
  options: VoiceCaptureOptions = {}
): Promise<string> {
  const lang = options.lang || "fa-IR";
  const nativePlugin = getCapacitorNativeSpeechPlugin();

  if (nativePlugin) {
    return captureWithCapacitorNative(nativePlugin, lang, options);
  }

  const WebRecognition = getWebSpeechRecognitionConstructor();
  if (WebRecognition) {
    return captureWithWebSpeech(WebRecognition, lang, options);
  }

  throw new Error(
    "تشخیص گفتار در این مرورگر یا دستگاه پشتیبانی نمی‌شود. لطفاً از مرورگر کروم یا نسخه اندروید برنامه استفاده کنید."
  );
}

async function captureWithCapacitorNative(
  plugin: CapacitorSpeechPluginLike,
  lang: string,
  options: VoiceCaptureOptions
): Promise<string> {
  try {
    const perm = await plugin.checkPermissions();
    if (perm.speechRecognition !== "granted") {
      const req = await plugin.requestPermissions();
      if (req.speechRecognition !== "granted") {
        throw new Error(
          "مجوز دسترسی به میکروفون داده نشد. لطفاً در تنظیمات گوشی دسترسی میکروفون را برای برنامه «گویا» فعال کنید."
        );
      }
    }
  } catch (err: any) {
    if (err?.message?.includes("مجوز")) {
      throw err;
    }
    const req = await plugin.requestPermissions().catch(() => null);
    if (req && req.speechRecognition !== "granted") {
      throw new Error(
        "مجوز دسترسی به میکروفون داده نشد. لطفاً دسترسی میکروفون را فعال کنید."
      );
    }
  }

  const postSpeechSilenceMs = options.postSpeechSilenceMs ?? 5500;
  const initialSilenceMs = options.initialSilenceMs ?? 12000;

  let committedText = "";
  let currentSegmentText = "";
  let hadSpeechInCurrentSegment = false;
  let settled = false;
  let userStopped = false;
  let lastWordTime = 0;

  const getCleanText = () => {
    const combined = [committedText, currentSegmentText]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    return collapseRepeatedPrefixes(combined);
  };

  return new Promise<string>(async (resolve, reject) => {
    let partialHandle: { remove: () => Promise<void> } | null = null;
    let stateHandle: { remove: () => Promise<void> } | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = async () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      options.onListeningChange?.(false);
      try {
        if (partialHandle) await partialHandle.remove();
        if (stateHandle) await stateHandle.remove();
      } catch {
        // نادیده گرفتن خطای پاکسازی
      }
    };

    const finishWithSuccess = async (text: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      await cleanup();
      resolve(collapseRepeatedPrefixes(text));
    };

    const finishWithError = async (message: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      await cleanup();
      reject(new Error(message));
    };

    const resetTimer = (hasSpokenAnything: boolean) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      const timeoutMs = hasSpokenAnything
        ? postSpeechSilenceMs
        : initialSilenceMs;

      silenceTimer = setTimeout(async () => {
        userStopped = true;
        try {
          await plugin.stop();
        } catch {
          // نادیده گرفتن
        }
        const finalStr = getCleanText();
        if (finalStr) {
          await finishWithSuccess(finalStr);
        } else {
          await finishWithError(
            "صدایی دریافت نشد. لطفاً دوباره دکمه میکروفون را بزنید و صحبت کنید."
          );
        }
      }, timeoutMs);
    };

    const startNativeSegment = async () => {
      if (settled || userStopped) return;
      hadSpeechInCurrentSegment = false;

      const res = await plugin.start({
        language: lang,
        maxResults: 3,
        partialResults: true,
        popup: false,
      });

      if (
        res &&
        Array.isArray((res as any).matches) &&
        (res as any).matches[0]
      ) {
        const raw = (res as any).matches[0].trim();
        if (raw) {
          hadSpeechInCurrentSegment = true;
          lastWordTime = Date.now();
          currentSegmentText = mergeCumulativeSpeech(currentSegmentText, raw);
          const cleaned = getCleanText();
          options.onInterimResult?.(cleaned);
          resetTimer(true);
        }
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        await finishWithSuccess(getCleanText());
        return;
      }
      options.signal.addEventListener(
        "abort",
        async () => {
          userStopped = true;
          try {
            await plugin.stop();
          } catch {
            // نادیده گرفتن
          }
          await finishWithSuccess(getCleanText());
        },
        { once: true }
      );
    }

    try {
      partialHandle = await plugin.addListener(
        "partialResults",
        (data: { matches?: string[] }) => {
          if (settled) return;
          const raw = data?.matches?.[0]?.trim() || "";
          if (raw) {
            hadSpeechInCurrentSegment = true;
            lastWordTime = Date.now();
            currentSegmentText = mergeCumulativeSpeech(currentSegmentText, raw);
            const cleaned = getCleanText();
            options.onInterimResult?.(cleaned);
            resetTimer(true);
          }
        }
      );

      stateHandle = await plugin.addListener(
        "listeningState",
        async (data: { status?: "started" | "stopped" }) => {
          if (settled) return;
          if (data?.status === "started") {
            options.onListeningChange?.(true);
          } else if (data?.status === "stopped") {
            setTimeout(async () => {
              if (settled || userStopped) return;

              // اگر کاربر در همین قطعه صحبت کرده و مکث کوتاهی داشته (کمتر از مهلت سکوت)،
              // قطعه قبلی را ذخیره کن و فقط در همین حالت اجازه ادامه صحبت بده
              const elapsedSinceWord = Date.now() - lastWordTime;
              if (
                hadSpeechInCurrentSegment &&
                elapsedSinceWord < postSpeechSilenceMs - 500
              ) {
                if (currentSegmentText.trim()) {
                  committedText = [committedText, currentSegmentText.trim()]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  currentSegmentText = "";
                }
                try {
                  await startNativeSegment();
                  return;
                } catch {
                  // اگر ادامه ممکن نبود، متن دریافت‌شده را نهایی کن
                }
              }

              const finalStr = getCleanText();
              if (finalStr) {
                await finishWithSuccess(finalStr);
              } else {
                await finishWithError(
                  "صدایی تشخیص داده نشد. لطفاً دوباره روی دکمه میکروفون بزنید و صحبت کنید."
                );
              }
            }, 450);
          }
        }
      );

      options.onListeningChange?.(true);
      resetTimer(false);
      await startNativeSegment();
    } catch {
      try {
        if (silenceTimer) clearTimeout(silenceTimer);
        const popupRes = await plugin.start({
          language: lang,
          maxResults: 3,
          partialResults: false,
          popup: true,
          prompt: "دستور فارسی خود را بگویید...",
        });
        const match =
          (popupRes && "matches" in popupRes && popupRes.matches?.[0]?.trim()) ||
          "";
        if (match) {
          const cleaned = collapseRepeatedPrefixes(match);
          options.onInterimResult?.(cleaned);
          await finishWithSuccess(cleaned);
        } else {
          await finishWithError("متنی از گفتار دریافت نشد.");
        }
      } catch (popupErr: any) {
        await finishWithError(
          translateSpeechError(popupErr?.message || String(popupErr))
        );
      }
    }
  });
}

function captureWithWebSpeech(
  WebRecognition: any,
  lang: string,
  options: VoiceCaptureOptions
): Promise<string> {
  const postSpeechSilenceMs = options.postSpeechSilenceMs ?? 5500;
  const initialSilenceMs = options.initialSilenceMs ?? 12000;

  return new Promise<string>((resolve, reject) => {
    const recognition = new WebRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let committedText = "";
    let currentSessionTranscript = "";
    let hadSpeechInCurrentSession = false;
    let lastSpeechTime = 0;
    let settled = false;
    let userStopped = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const getCleanTranscript = () => {
      const combined = [committedText, currentSessionTranscript]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      return collapseRepeatedPrefixes(combined);
    };

    const clearTimer = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    const finishSuccess = (text: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      clearTimer();
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        // نادیده گرفتن
      }
      options.onListeningChange?.(false);
      resolve(collapseRepeatedPrefixes(text));
    };

    const finishError = (msg: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      clearTimer();
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        // نادیده گرفتن
      }
      options.onListeningChange?.(false);
      reject(new Error(msg));
    };

    const resetSilenceTimer = (hasSpoken: boolean) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      const waitMs = hasSpoken ? postSpeechSilenceMs : initialSilenceMs;

      silenceTimer = setTimeout(() => {
        userStopped = true;
        const finalStr = getCleanTranscript();
        if (finalStr) {
          finishSuccess(finalStr);
        } else {
          finishError(
            "صدایی دریافت نشد. لطفاً میکروفون را فعال کرده و دستور خود را بیان کنید."
          );
        }
      }, waitMs);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finishSuccess("");
        return;
      }
      options.signal.addEventListener(
        "abort",
        () => {
          userStopped = true;
          finishSuccess(getCleanTranscript());
        },
        { once: true }
      );
    }

    recognition.onstart = () => {
      if (!settled) {
        hadSpeechInCurrentSession = false;
        options.onListeningChange?.(true);
      }
    };

    recognition.onresult = (event: any) => {
      if (settled) return;

      let merged = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const chunk = (result[0]?.transcript || "").trim();
        if (chunk) {
          merged = mergeCumulativeSpeech(merged, chunk);
        }
      }

      if (merged) {
        hadSpeechInCurrentSession = true;
        lastSpeechTime = Date.now();
        currentSessionTranscript = merged;
        const cleaned = getCleanTranscript();
        options.onInterimResult?.(cleaned);
        resetSilenceTimer(true);
      }
    };

    recognition.onerror = (event: any) => {
      if (settled) return;
      const code = String(event?.error || "").toLowerCase();

      if (code === "no-speech" || code === "aborted") {
        const existing = getCleanTranscript();
        if (existing) {
          finishSuccess(existing);
        } else if (userStopped || code === "aborted") {
          finishSuccess("");
        }
        return;
      }

      const existing = getCleanTranscript();
      if (existing) {
        finishSuccess(existing);
        return;
      }

      finishError(translateSpeechError(code));
    };

    recognition.onend = () => {
      if (settled) return;

      if (userStopped) {
        finishSuccess(getCleanTranscript());
        return;
      }

      // اگر مرورگر در میانه مکث کوتاه کاربر (در حالی که در همین نشست صحبت کرده بود) ارتباط را بست،
      // متن قبلی را حفظ کن و اجازه بده کاربر ادامه جمله‌اش را بگوید.
      // اما اگر در نشست فعلی هیچ صحبتی نشده بود، دیگر ری‌استارت نکن تا حلقه قطع و وصل رخ ندهد!
      const elapsedSinceLastSpeech = Date.now() - lastSpeechTime;
      if (
        hadSpeechInCurrentSession &&
        elapsedSinceLastSpeech < postSpeechSilenceMs - 500
      ) {
        if (currentSessionTranscript.trim()) {
          committedText = [committedText, currentSessionTranscript.trim()]
            .filter(Boolean)
            .join(" ")
            .trim();
          currentSessionTranscript = "";
        }
        hadSpeechInCurrentSession = false;
        try {
          recognition.start();
          return;
        } catch {
          // اگر شروع مجدد ممکن نبود، همان متن دریافت‌شده را برگردان
        }
      }

      const finalStr = getCleanTranscript();
      if (finalStr) {
        finishSuccess(finalStr);
      } else {
        finishError(
          "صدایی تشخیص داده نشد. لطفاً دوباره روی دکمه میکروفون بزنید و صحبت کنید."
        );
      }
    };

    try {
      options.onListeningChange?.(true);
      resetSilenceTimer(false);
      recognition.start();
    } catch (err: any) {
      finishError(translateSpeechError(err?.message || String(err)));
    }
  });
}

function translateSpeechError(rawError: string): string {
  const err = (rawError || "").toLowerCase();
  if (
    err.includes("not-allowed") ||
    err.includes("permission") ||
    err.includes("service-not-allowed")
  ) {
    return "دسترسی به میکروفون مسدود است. لطفاً مجوز استفاده از میکروفون را در مرورگر یا تنظیمات گوشی تایید کنید.";
  }
  if (
    err.includes("no-speech") ||
    err.includes("no match") ||
    err.includes("timeout")
  ) {
    return "صدایی تشخیص داده نشد. لطفاً دوباره روی دکمه میکروفون بزنید و صحبت کنید.";
  }
  if (err.includes("audio-capture") || err.includes("audio recording")) {
    return "میکروفون یافت نشد یا برنامه دیگری در حال استفاده از میکروفون است.";
  }
  if (err.includes("network")) {
    return "خطا در ارتباط سرویس تشخیص گفتار. لطفاً اتصال یا سرویس گفتار گوگل در گوشی را بررسی کنید.";
  }
  return "دریافت صدا متوقف شد یا خطایی رخ داد. لطفاً دوباره تلاش کنید.";
}
