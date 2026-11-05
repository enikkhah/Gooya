/**
 * ماژول مستقل دریافت متن از گفتار فارسی (ASR)
 * بدون وابستگی خارجی — سازگار با:
 * ۱) پلاگین بومی Capacitor در اندروید و iOS (@capacitor-community/speech-recognition)
 * ۲) استاندارد Web Speech API در مرورگرها (SpeechRecognition / webkitSpeechRecognition)
 *
 * ویژگی‌ها:
 * - محاسبه زمانی دقیق مهلت شروع (۱۰ ثانیه) و مهلت مکث بین کلمات/جملات (۵.۵ ثانیه پس از هر کلمه)
 * - ایجاد نمونه تازه (Fresh Instance) با تاخیر ایمن در صورت بسته شدن زودهنگام نشست توسط مرورگر در حین مکث
 * - پاک‌سازی کامل شنونده‌ها و جلوگیری از قفل شدن plugin.stop() در اندروید برای عملکرد یکسان در دفعات دوم، سوم و بعدی
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
  /** مهلت سکوت پس از هر بار صحبت به میلی‌ثانیه برای لحاظ کردن مکث‌های عادی (پیش‌فرض: ۵۵۰۰ میلی‌ثانیه) */
  postSpeechSilenceMs?: number;
  /** مهلت اولیه شروع صحبت به میلی‌ثانیه (پیش‌فرض: ۱۰۰۰۰ میلی‌ثانیه) */
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
 * توقف ایمن پلاگین بومی بدون قفل شدن Promise (در نسخه ۷ پلاگین اندروید متد stop گاهی resolve نمی‌کند)
 */
async function safePluginStop(plugin: CapacitorSpeechPluginLike): Promise<void> {
  try {
    await Promise.race([
      plugin.stop(),
      new Promise<void>((r) => setTimeout(r, 200)),
    ]);
  } catch {
    // نادیده گرفتن خطا
  }
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

  // پاک‌سازی کامل هرگونه شنونده یا نشست باقی‌مانده از دفعات قبلی
  await safePluginStop(plugin);
  try {
    await plugin.removeAllListeners();
  } catch {
    // نادیده گرفتن
  }

  const postSpeechSilenceMs = options.postSpeechSilenceMs ?? 5500;
  const initialSilenceMs = options.initialSilenceMs ?? 10000;

  const sessionStartTime = Date.now();
  let lastWordTime = 0;
  let committedText = "";
  let currentSegmentText = "";
  let settled = false;
  let userStopped = false;
  let restartingSegment = false;

  const getRemainingGraceMs = (): number => {
    const now = Date.now();
    if (lastWordTime > 0) {
      return postSpeechSilenceMs - (now - lastWordTime);
    }
    return initialSilenceMs - (now - sessionStartTime);
  };

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
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = async () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      options.onListeningChange?.(false);
      await safePluginStop(plugin);
      try {
        if (partialHandle) await partialHandle.remove();
        if (stateHandle) await stateHandle.remove();
        await plugin.removeAllListeners();
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

    const scheduleSilenceCutoff = (waitMs: number) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(async () => {
        if (settled) return;
        userStopped = true;
        const finalStr = getCleanText();
        if (finalStr) {
          await finishWithSuccess(finalStr);
        } else {
          await finishWithError(
            "صدایی دریافت نشد. لطفاً دوباره دکمه میکروفون را بزنید و صحبت کنید."
          );
        }
      }, Math.max(500, waitMs));
    };

    const startNativeSegment = async () => {
      if (settled || userStopped) return;
      restartingSegment = false;

      try {
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
            lastWordTime = Date.now();
            currentSegmentText = mergeCumulativeSpeech(currentSegmentText, raw);
            const cleaned = getCleanText();
            options.onInterimResult?.(cleaned);
            scheduleSilenceCutoff(postSpeechSilenceMs);
          }
        }
      } catch (err: any) {
        if (settled || userStopped) return;
        const remaining = getRemainingGraceMs();
        if (remaining > 700) {
          scheduleNextNativeSegment();
          return;
        }
        const finalStr = getCleanText();
        if (finalStr) {
          await finishWithSuccess(finalStr);
        } else {
          await finishWithError(
            translateSpeechError(err?.message || String(err))
          );
        }
      }
    };

    const scheduleNextNativeSegment = () => {
      if (settled || userStopped || restartingSegment) return;
      const remaining = getRemainingGraceMs();
      if (remaining <= 700) {
        const finalStr = getCleanText();
        if (finalStr) {
          finishWithSuccess(finalStr);
        } else {
          finishWithError(
            "صدایی تشخیص داده نشد. لطفاً دوباره روی دکمه میکروفون بزنید و صحبت کنید."
          );
        }
        return;
      }

      restartingSegment = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (settled || userStopped) return;
        if (currentSegmentText.trim()) {
          committedText = [committedText, currentSegmentText.trim()]
            .filter(Boolean)
            .join(" ")
            .trim();
          currentSegmentText = "";
        }
        startNativeSegment();
      }, 300);
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
          await finishWithSuccess(getCleanText());
        },
        { once: true }
      );
    }

    try {
      partialHandle = await plugin.addListener(
        "partialResults",
        (data: { matches?: string[] }) => {
          if (settled || userStopped) return;
          const raw = data?.matches?.[0]?.trim() || "";
          if (raw) {
            lastWordTime = Date.now();
            currentSegmentText = mergeCumulativeSpeech(currentSegmentText, raw);
            const cleaned = getCleanText();
            options.onInterimResult?.(cleaned);
            scheduleSilenceCutoff(postSpeechSilenceMs);
          }
        }
      );

      stateHandle = await plugin.addListener(
        "listeningState",
        async (data: { status?: "started" | "stopped" }) => {
          if (settled || userStopped) return;
          if (data?.status === "started") {
            options.onListeningChange?.(true);
          } else if (data?.status === "stopped") {
            scheduleNextNativeSegment();
          }
        }
      );

      options.onListeningChange?.(true);
      scheduleSilenceCutoff(initialSilenceMs);
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
  const initialSilenceMs = options.initialSilenceMs ?? 10000;

  return new Promise<string>((resolve, reject) => {
    const sessionStartTime = Date.now();
    let lastSpeechTime = 0;
    let committedText = "";
    let currentSegmentText = "";
    let activeRecognition: any = null;
    let settled = false;
    let userStopped = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const getRemainingGraceMs = (): number => {
      const now = Date.now();
      if (lastSpeechTime > 0) {
        return postSpeechSilenceMs - (now - lastSpeechTime);
      }
      return initialSilenceMs - (now - sessionStartTime);
    };

    const getCleanTranscript = () => {
      const combined = [committedText, currentSegmentText]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      return collapseRepeatedPrefixes(combined);
    };

    const clearTimers = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
    };

    const stopActiveRecognizer = () => {
      if (!activeRecognition) return;
      try {
        activeRecognition.onresult = null;
        activeRecognition.onerror = null;
        activeRecognition.onend = null;
        activeRecognition.onstart = null;
        activeRecognition.stop();
      } catch {
        // نادیده گرفتن
      }
      activeRecognition = null;
    };

    const finishSuccess = (text: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      clearTimers();
      stopActiveRecognizer();
      options.onListeningChange?.(false);
      resolve(collapseRepeatedPrefixes(text));
    };

    const finishError = (msg: string) => {
      if (settled) return;
      settled = true;
      userStopped = true;
      clearTimers();
      stopActiveRecognizer();
      options.onListeningChange?.(false);
      reject(new Error(msg));
    };

    const scheduleSilenceCutoff = (waitMs: number) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (settled) return;
        userStopped = true;
        const finalStr = getCleanTranscript();
        if (finalStr) {
          finishSuccess(finalStr);
        } else {
          finishError(
            "صدایی دریافت نشد. لطفاً میکروفون را فعال کرده و دستور خود را بیان کنید."
          );
        }
      }, Math.max(500, waitMs));
    };

    const startFreshWebSegment = () => {
      if (settled || userStopped) return;

      stopActiveRecognizer();

      const recognition = new WebRecognition();
      activeRecognition = recognition;
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (!settled && !userStopped) {
          options.onListeningChange?.(true);
        }
      };

      recognition.onresult = (event: any) => {
        if (settled || userStopped) return;

        let merged = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const chunk = (result[0]?.transcript || "").trim();
          if (chunk) {
            merged = mergeCumulativeSpeech(merged, chunk);
          }
        }

        if (merged) {
          lastSpeechTime = Date.now();
          currentSegmentText = merged;
          const cleaned = getCleanTranscript();
          options.onInterimResult?.(cleaned);
          // هر بار که کلمه‌ای دریافت می‌شود، مهلت مکث ۵.۵ ثانیه‌ای از نو تنظیم می‌شود
          scheduleSilenceCutoff(postSpeechSilenceMs);
        }
      };

      recognition.onerror = (event: any) => {
        if (settled || userStopped) return;
        const code = String(event?.error || "").toLowerCase();

        // خطاهای قطعی مثل عدم مجوز میکروفون بلافاصله متوقف شوند
        if (
          code.includes("not-allowed") ||
          code.includes("service-not-allowed") ||
          code.includes("audio-capture")
        ) {
          finishError(translateSpeechError(code));
          return;
        }

        // برای no-speech یا aborted اجازه می‌دهیم onend تصمیم بگیرد که آیا هنوز مهلت مکث باقی مانده یا خیر
      };

      recognition.onend = () => {
        if (settled) return;

        if (userStopped) {
          finishSuccess(getCleanTranscript());
          return;
        }

        // ذخیره کلمات دریافت‌شده در این قطعه پیش از بررسی مهلت مکث
        if (currentSegmentText.trim()) {
          committedText = [committedText, currentSegmentText.trim()]
            .filter(Boolean)
            .join(" ")
            .trim();
          currentSegmentText = "";
        }

        // اگر هنوز از مهلت اولیه (۱۰ ثانیه) یا مهلت مکث پس از آخرین کلمه (۵.۵ ثانیه) زمان باقی مانده است،
        // یک نمونه تازه با تاخیر کوتاه بساز تا مکث‌های دوم، سوم و بعدی هم کاملاً پوشش داده شوند
        const remaining = getRemainingGraceMs();
        if (remaining > 650) {
          if (restartTimer) clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (!settled && !userStopped) {
              startFreshWebSegment();
            }
          }, 180);
          return;
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
        recognition.start();
      } catch (err: any) {
        const existing = getCleanTranscript();
        if (existing) {
          finishSuccess(existing);
        } else {
          finishError(translateSpeechError(err?.message || String(err)));
        }
      }
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

    options.onListeningChange?.(true);
    scheduleSilenceCutoff(initialSilenceMs);
    startFreshWebSegment();
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
