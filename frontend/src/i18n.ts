import React, { createContext, useContext } from "react";

export type Locale = "en" | "fa";

type Strings = Record<string, string>;

const en: Strings = {
  // Nav
  "nav.home": "Home",
  "nav.accounts": "Accounts",
  "nav.dashboard": "Dashboard",
  "nav.logs": "Logs",
  "nav.settings": "Settings",
  "nav.cert": "Certificate",
  "nav.about": "About",
  "lang.toggle": "فارسی",

  // Header / connect button
  "header.notRunning": "Not running",
  "btn.connect": "Connect",
  "btn.disconnect": "Disconnect",
  "btn.connecting": "Connecting…",
  "btn.pleaseWait": "Please wait…",

  // Status
  "status.connected": "Connected",
  "status.disconnected": "Disconnected",
  "status.connecting": "Connecting",

  // Toasts
  "toast.disconnected": "Proxy disconnected.",
  "toast.connected": "Proxy connected.",
  "toast.accountsSaved": "Accounts saved.",
  "toast.settingsSaved": "Settings saved.",
  "toast.googleIPSet": "Google IP set to {ip}",
  "toast.caInstalled": "CA installed. Restart Chrome/Safari to apply.",
  "toast.caRemoved": "CA certificate removed.",
  "toast.pemCopied": "PEM copied to clipboard.",

  // Home / hero
  "hero.establishing": "Establishing tunnel…",
  "hero.tapConnect": "Tap connect to start tunnelling",
  "hero.via": "via",
  "hero.routeBrowser": "Browser",
  "hero.routeProxy": "Proxy",
  "hero.routeAppsScript": "Apps Script",
  "hero.routeTarget": "Target",

  // Stat tiles
  "stat.requests": "Requests",
  "stat.errorsSuffix": "errors",
  "stat.latency": "Latency",
  "stat.fast": "Fast",
  "stat.normal": "Normal",
  "stat.slow": "Slow",
  "stat.downloaded": "Downloaded",
  "stat.success": "Success",
  "stat.ok": "ok",
  "stat.noTraffic": "no traffic",

  // Quota panel
  "quota.title": "Daily Quota",
  "quota.usedSuffix": "used",
  "quota.callsToday": "Calls today",
  "quota.dailyLimit": "Daily limit",
  "quota.remaining": "Remaining",

  // Certificate panel (home)
  "homecert.title": "Certificate",
  "homecert.trusted": "CA Trusted",
  "homecert.notTrusted": "Not Trusted",
  "homecert.trustedBody": "HTTPS interception is working.",
  "homecert.notTrustedBody": "Visit Certificate tab to install.",
  "homecert.httpProxy": "HTTP proxy",
  "homecert.socks5": "SOCKS5",
  "homecert.off": "off",

  // Accounts
  "accounts.save": "Save",
  "accounts.add": "Add Account",
  "accounts.empty.prefix": "No accounts yet — click ",
  "accounts.empty.suffix": " to add your first Apps Script deployment.",
  "accounts.label": "Label",
  "accounts.scriptId": "Script Deployment ID",
  "accounts.dailyQuota": "Daily quota",
  "accounts.enable": "Enable",
  "accounts.disable": "Disable",
  "accounts.remove": "Remove",
  "accounts.consumer": "consumer",
  "accounts.workspace": "workspace",

  // Dashboard
  "dash.upload": "Upload",
  "dash.download": "Download",
  "dash.requests": "Requests",
  "dash.errors": "Errors",
  "dash.host": "Host",
  "dash.avgLatency": "Avg Latency",
  "dash.noTraffic": "No traffic yet",

  // Settings
  "settings.googleIP": "Google IP",
  "settings.frontDomain": "Front Domain",
  "settings.authKey": "Auth Key",
  "settings.logLevel": "Log Level",
  "settings.listenHost": "Listen Host",
  "settings.httpPort": "HTTP Port",
  "settings.socks5Port": "SOCKS5 Port",
  "settings.save": "Save Settings",
  "settings.scan": "Scan Front IPs",
  "settings.forceRelaySNI": "Route YouTube/CDN traffic through Apps Script",
  "settings.forceRelaySNIHelp": "By default YouTube and similar hosts use SNI rewrite (direct to Google's edge with hidden hostname). Enable to send them through Apps Script — slower and quota-eating, but works when the direct path is blocked.",
  "settings.cookieDebug": "Cookie debug logging",
  "settings.cookieDebugHelp": "Log every individual Set-Cookie header at INFO level. Verbose — enable only when diagnosing login/auth issues.",
  "settings.directTunnelHosts": "Direct Tunnel Hosts",
  "settings.directTunnelHostsHelp": "Hosts that bypass the relay entirely and connect directly (comma-separated). Use for API endpoints that time out through the relay, e.g. api.x.com. Only works if the host is reachable from your network.",
  "settings.blockHosts": "Blocked Hosts",

  // Certificate tab
  "cert.tab.auto": "Quick Install",
  "cert.tab.macos": "macOS",
  "cert.tab.firefox": "Firefox",
  "cert.tab.windows": "Windows",
  "cert.tab.linux": "Linux",
  "cert.status": "Status",
  "cert.trustedBySystem": "Trusted by System",
  "cert.notTrusted": "Not Trusted",
  "cert.showInFinder": "Show in Finder",
  "cert.copyPEM": "Copy PEM",
  "cert.remove": "Remove",
  "cert.subject": "Subject",
  "cert.validUntil": "Valid Until",
  "cert.fingerprint": "SHA-256 Fingerprint",
  "cert.path": "Certificate Path",
  "cert.install": "Install CA Certificate",
  "cert.alreadyInstalled": "Already installed",
  "cert.auto.title": "Install to Login Keychain",
  "cert.auto.body": "Adds the CA to your macOS login keychain — no admin password required. Chrome, Safari, and most apps trust it immediately.",
  "cert.auto.firefoxNote.title": "Firefox is not covered by this button",
  "cert.auto.firefoxNote.bodyA": "Firefox maintains its own certificate store and ignores the macOS keychain. Open the ",
  "cert.auto.firefoxNote.bodyB": " tab for manual import steps.",
  "cert.auto.restart.title": "Restart your browser",
  "cert.auto.restart.body": "Fully quit (⌘Q) and reopen Chrome or Safari. The warning should be gone.",

  "cert.macos.optionATitle": "Option A — Use the Quick Install button above (recommended)",
  "cert.macos.optionABody": "The button on the Quick Install tab runs the command below automatically.",
  "cert.macos.optionBTitle": "Option B — Terminal (same result, no sudo needed)",
  "cert.macos.optionCTitle": "Option C — Keychain Access GUI",
  "cert.macos.optionCBodyA": "Open ",
  "cert.macos.optionCBodyB": " → File → Import Items → select the .crt file → double-click it → Trust → ",
  "cert.macos.optionCBodyC": " → enter your password.",
  "cert.macos.alwaysTrust": "Always Trust",

  "cert.firefox.warnTitle": "Firefox has its own certificate store",
  "cert.firefox.warnBody": "The system keychain has no effect on Firefox. You must import the CA manually into every Firefox profile.",
  "cert.firefox.openTitle": "Open Certificate Manager",
  "cert.firefox.openBodyA": "In Firefox, navigate to ",
  "cert.firefox.openBodyB": ", scroll to the bottom, and click ",
  "cert.firefox.viewCerts": "View Certificates…",
  "cert.firefox.importTitle": "Import the certificate",
  "cert.firefox.importBodyA": "Go to the ",
  "cert.firefox.importBodyB": " tab → click ",
  "cert.firefox.importBodyC": " → select:",
  "cert.firefox.authorities": "Authorities",
  "cert.firefox.import": "Import…",
  "cert.firefox.trustTitle": "Trust for websites",
  "cert.firefox.trustBodyA": "Check ",
  "cert.firefox.trustBodyB": " and click ",
  "cert.firefox.trustText": "\"Trust this CA to identify websites\"",
  "cert.firefox.ok": "OK",
  "cert.firefox.restartTitle": "Restart Firefox",
  "cert.firefox.restartBody": "Quit Firefox completely (⌘Q) and reopen it.",

  "cert.windows.autoTitle": "Auto-install via the Quick Install tab",
  "cert.windows.autoBodyA": "The install button runs ",
  "cert.windows.autoBodyB": " which adds the CA to your personal certificate store — no admin rights needed.",
  "cert.windows.guiTitle": "Manual — Certificate Manager GUI",
  "cert.windows.guiBodyA": "Press ",
  "cert.windows.guiBodyB": " → type ",
  "cert.windows.guiBodyC": " → right-click ",
  "cert.windows.trustedRoot": "Trusted Root Certification Authorities",
  "cert.windows.guiBodyD": " → All Tasks → Import… → follow the wizard.",
  "cert.windows.cliTitle": "Manual — Command line (run as Administrator for system-wide)",

  "cert.linux.debianTitle": "Debian / Ubuntu",
  "cert.linux.fedoraTitle": "Fedora / RHEL / CentOS",
  "cert.linux.firefoxTitle": "Firefox on Linux",
  "cert.linux.firefoxBodyA": "Firefox on Linux also ignores the system store. Follow the ",
  "cert.linux.firefoxBodyB": " tab instructions. Chrome on Linux uses the NSS store — check Settings → Privacy and security → Manage certificates → Authorities → Import.",

  // About
  "about.tagline": "A Go/Wails desktop relay proxy that tunnels HTTP and HTTPS traffic through Google Apps Script deployments using protocol v2.",
  "about.defaults": "Default addresses",
  "about.dataDir": "Config & data directory",
  "about.httpProxy": "HTTP proxy",
  "about.socks5Proxy": "SOCKS5 proxy",
  "about.stats": "Stats",
  "about.statsThrough": "through the proxy",

  // Errors
  "error.boundary.title": "Something went wrong",
  "error.boundary.retry": "Try again",
};

const fa: Strings = {
  // Nav
  "nav.home": "خانه",
  "nav.accounts": "حساب‌ها",
  "nav.dashboard": "داشبورد",
  "nav.logs": "گزارش‌ها",
  "nav.settings": "تنظیمات",
  "nav.cert": "گواهی",
  "nav.about": "درباره",
  "lang.toggle": "English",

  // Header / connect button
  "header.notRunning": "در حال اجرا نیست",
  "btn.connect": "اتصال",
  "btn.disconnect": "قطع اتصال",
  "btn.connecting": "در حال اتصال…",
  "btn.pleaseWait": "لطفاً صبر کنید…",

  // Status
  "status.connected": "متصل",
  "status.disconnected": "قطع",
  "status.connecting": "در حال اتصال",

  // Toasts
  "toast.disconnected": "پروکسی قطع شد.",
  "toast.connected": "پروکسی متصل شد.",
  "toast.accountsSaved": "حساب‌ها ذخیره شد.",
  "toast.settingsSaved": "تنظیمات ذخیره شد.",
  "toast.googleIPSet": "آی‌پی گوگل روی {ip} تنظیم شد",
  "toast.caInstalled": "گواهی نصب شد. برای اعمال، Chrome/Safari را مجدد راه‌اندازی کنید.",
  "toast.caRemoved": "گواهی حذف شد.",
  "toast.pemCopied": "PEM در کلیپ‌بورد کپی شد.",

  // Home / hero
  "hero.establishing": "در حال برقراری تونل…",
  "hero.tapConnect": "برای شروع تونل‌سازی روی اتصال بزنید",
  "hero.via": "از طریق",
  "hero.routeBrowser": "مرورگر",
  "hero.routeProxy": "پروکسی",
  "hero.routeAppsScript": "Apps Script",
  "hero.routeTarget": "مقصد",

  // Stat tiles
  "stat.requests": "درخواست‌ها",
  "stat.errorsSuffix": "خطا",
  "stat.latency": "تأخیر",
  "stat.fast": "سریع",
  "stat.normal": "متعارف",
  "stat.slow": "کند",
  "stat.downloaded": "دریافت‌شده",
  "stat.success": "موفقیت",
  "stat.ok": "موفق",
  "stat.noTraffic": "بدون ترافیک",

  // Quota panel
  "quota.title": "سهمیه روزانه",
  "quota.usedSuffix": "مصرف شده",
  "quota.callsToday": "درخواست‌های امروز",
  "quota.dailyLimit": "محدودیت روزانه",
  "quota.remaining": "باقی‌مانده",

  // Certificate panel (home)
  "homecert.title": "گواهی",
  "homecert.trusted": "گواهی معتبر",
  "homecert.notTrusted": "نامعتبر",
  "homecert.trustedBody": "رهگیری HTTPS فعال است.",
  "homecert.notTrustedBody": "برای نصب به تب گواهی بروید.",
  "homecert.httpProxy": "پروکسی HTTP",
  "homecert.socks5": "SOCKS5",
  "homecert.off": "خاموش",

  // Accounts
  "accounts.save": "ذخیره",
  "accounts.add": "افزودن حساب",
  "accounts.empty.prefix": "هنوز حسابی ندارید — برای افزودن اولین استقرار Apps Script روی ",
  "accounts.empty.suffix": " بزنید.",
  "accounts.label": "برچسب",
  "accounts.scriptId": "شناسه استقرار اسکریپت",
  "accounts.dailyQuota": "سهمیه روزانه",
  "accounts.enable": "فعال‌سازی",
  "accounts.disable": "غیرفعال‌سازی",
  "accounts.remove": "حذف",
  "accounts.consumer": "مصرف‌کننده",
  "accounts.workspace": "ورک‌اسپیس",

  // Dashboard
  "dash.upload": "ارسال",
  "dash.download": "دریافت",
  "dash.requests": "درخواست‌ها",
  "dash.errors": "خطاها",
  "dash.host": "میزبان",
  "dash.avgLatency": "میانگین تأخیر",
  "dash.noTraffic": "هنوز ترافیکی نیست",

  // Settings
  "settings.googleIP": "آی‌پی گوگل",
  "settings.frontDomain": "دامنه جلویی",
  "settings.authKey": "کلید احراز هویت",
  "settings.logLevel": "سطح لاگ",
  "settings.listenHost": "میزبان شنود",
  "settings.httpPort": "پورت HTTP",
  "settings.socks5Port": "پورت SOCKS5",
  "settings.save": "ذخیره تنظیمات",
  "settings.scan": "اسکن آی‌پی‌های جلویی",
  "settings.forceRelaySNI": "هدایت ترافیک YouTube/CDN از طریق Apps Script",
  "settings.forceRelaySNIHelp": "به‌طور پیش‌فرض YouTube و میزبان‌های مشابه از بازنویسی SNI استفاده می‌کنند (مستقیم به لبه گوگل با نام میزبان پنهان). این گزینه آن‌ها را از طریق Apps Script ارسال می‌کند — کندتر و سهمیه‌بر است، اما زمانی که مسیر مستقیم مسدود است کار می‌کند.",
  "settings.cookieDebug": "لاگ دیباگ کوکی",
  "settings.cookieDebugHelp": "هر هدر Set-Cookie را در سطح INFO ثبت می‌کند. فقط برای عیب‌یابی مشکلات ورود/احراز هویت فعال کنید.",
  "settings.directTunnelHosts": "میزبان‌های تونل مستقیم",
  "settings.directTunnelHostsHelp": "میزبان‌هایی که بدون رله مستقیماً متصل می‌شوند (با کاما جدا کنید). برای APIهایی که از طریق رله تایم‌اوت می‌شوند استفاده کنید، مثلاً api.x.com. فقط اگر میزبان از شبکه شما قابل دسترسی باشد کار می‌کند.",
  "settings.blockHosts": "میزبان‌های مسدود",

  // Certificate tab
  "cert.tab.auto": "نصب سریع",
  "cert.tab.macos": "macOS",
  "cert.tab.firefox": "Firefox",
  "cert.tab.windows": "Windows",
  "cert.tab.linux": "Linux",
  "cert.status": "وضعیت",
  "cert.trustedBySystem": "مورد اعتماد سیستم",
  "cert.notTrusted": "نامعتبر",
  "cert.showInFinder": "نمایش در Finder",
  "cert.copyPEM": "کپی PEM",
  "cert.remove": "حذف",
  "cert.subject": "موضوع",
  "cert.validUntil": "اعتبار تا",
  "cert.fingerprint": "اثر انگشت SHA-256",
  "cert.path": "مسیر گواهی",
  "cert.install": "نصب گواهی CA",
  "cert.alreadyInstalled": "قبلاً نصب شده",
  "cert.auto.title": "نصب در Login Keychain",
  "cert.auto.body": "گواهی را به Login Keychain مک‌اواس اضافه می‌کند — نیازی به رمز ادمین نیست. Chrome، Safari و بیشتر برنامه‌ها فوراً به آن اعتماد می‌کنند.",
  "cert.auto.firefoxNote.title": "این دکمه شامل Firefox نمی‌شود",
  "cert.auto.firefoxNote.bodyA": "Firefox فروشگاه گواهی خودش را دارد و keychain سیستم را نادیده می‌گیرد. برای راهنمای دستی به تب ",
  "cert.auto.firefoxNote.bodyB": " بروید.",
  "cert.auto.restart.title": "مرورگر را راه‌اندازی مجدد کنید",
  "cert.auto.restart.body": "Chrome یا Safari را کاملاً ببندید (⌘Q) و دوباره باز کنید. هشدار باید برطرف شده باشد.",

  "cert.macos.optionATitle": "گزینه A — استفاده از دکمه نصب سریع بالا (پیشنهادی)",
  "cert.macos.optionABody": "دکمه روی تب «نصب سریع» همان فرمان زیر را به‌طور خودکار اجرا می‌کند.",
  "cert.macos.optionBTitle": "گزینه B — ترمینال (نتیجه یکسان، بدون نیاز به sudo)",
  "cert.macos.optionCTitle": "گزینه C — رابط گرافیکی Keychain Access",
  "cert.macos.optionCBodyA": "باز کنید ",
  "cert.macos.optionCBodyB": " → File → Import Items → فایل .crt را انتخاب کنید → روی آن دوبار کلیک کنید → Trust → ",
  "cert.macos.optionCBodyC": " → رمز خود را وارد کنید.",
  "cert.macos.alwaysTrust": "Always Trust",

  "cert.firefox.warnTitle": "Firefox فروشگاه گواهی مخصوص خود را دارد",
  "cert.firefox.warnBody": "keychain سیستم تأثیری بر Firefox ندارد. باید CA را به‌صورت دستی در هر پروفایل Firefox وارد کنید.",
  "cert.firefox.openTitle": "بازکردن مدیر گواهی‌ها",
  "cert.firefox.openBodyA": "در Firefox به ",
  "cert.firefox.openBodyB": " بروید، تا پایین صفحه اسکرول کنید و روی ",
  "cert.firefox.viewCerts": "View Certificates…",
  "cert.firefox.importTitle": "وارد کردن گواهی",
  "cert.firefox.importBodyA": "به تب ",
  "cert.firefox.importBodyB": " بروید → روی ",
  "cert.firefox.importBodyC": " کلیک کنید → انتخاب کنید:",
  "cert.firefox.authorities": "Authorities",
  "cert.firefox.import": "Import…",
  "cert.firefox.trustTitle": "اعتماد برای وب‌سایت‌ها",
  "cert.firefox.trustBodyA": "گزینه ",
  "cert.firefox.trustBodyB": " را تیک بزنید و روی ",
  "cert.firefox.trustText": "«Trust this CA to identify websites»",
  "cert.firefox.ok": "OK",
  "cert.firefox.restartTitle": "Firefox را راه‌اندازی مجدد کنید",
  "cert.firefox.restartBody": "Firefox را کامل ببندید (⌘Q) و دوباره باز کنید.",

  "cert.windows.autoTitle": "نصب خودکار از طریق تب «نصب سریع»",
  "cert.windows.autoBodyA": "دکمه نصب فرمان ",
  "cert.windows.autoBodyB": " را اجرا می‌کند که CA را به فروشگاه گواهی شخصی شما اضافه می‌کند — بدون نیاز به دسترسی ادمین.",
  "cert.windows.guiTitle": "دستی — رابط گرافیکی Certificate Manager",
  "cert.windows.guiBodyA": "بزنید ",
  "cert.windows.guiBodyB": " → تایپ کنید ",
  "cert.windows.guiBodyC": " → راست‌کلیک روی ",
  "cert.windows.trustedRoot": "Trusted Root Certification Authorities",
  "cert.windows.guiBodyD": " → All Tasks → Import… → ویزارد را دنبال کنید.",
  "cert.windows.cliTitle": "دستی — خط فرمان (به‌عنوان Administrator برای کل سیستم)",

  "cert.linux.debianTitle": "Debian / Ubuntu",
  "cert.linux.fedoraTitle": "Fedora / RHEL / CentOS",
  "cert.linux.firefoxTitle": "Firefox روی Linux",
  "cert.linux.firefoxBodyA": "Firefox روی Linux نیز فروشگاه سیستم را نادیده می‌گیرد. دستورالعمل تب ",
  "cert.linux.firefoxBodyB": " را دنبال کنید. Chrome روی Linux از فروشگاه NSS استفاده می‌کند — Settings → Privacy and security → Manage certificates → Authorities → Import.",

  // About
  "about.tagline": "یک پروکسی رله دسکتاپ Go/Wails که ترافیک HTTP و HTTPS را با پروتکل v2 از طریق استقرارهای Google Apps Script تونل می‌کند.",
  "about.defaults": "آدرس‌های پیش‌فرض",
  "about.dataDir": "دایرکتوری تنظیمات و داده",
  "about.httpProxy": "پروکسی HTTP",
  "about.socks5Proxy": "پروکسی SOCKS5",
  "about.stats": "آمار",
  "about.statsThrough": "از طریق پروکسی",

  // Errors
  "error.boundary.title": "خطایی رخ داد",
  "error.boundary.retry": "تلاش مجدد",
};

const dictionaries: Record<Locale, Strings> = { en, fa };

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[locale] ?? en;
  let value = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

export const LocaleContext = createContext<Locale>("en");

export function useT() {
  const locale = useContext(LocaleContext);
  return React.useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}
