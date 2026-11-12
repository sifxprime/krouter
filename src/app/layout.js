import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

// Read from disk, not from fonts.googleapis.com.
//
// `next/font/google` fetches the font CSS during `next build`, so a production
// build only succeeds while Google answers the machine doing the building. It
// failed twice in one day — the first v0.5.183 npm publish and the v0.5.185
// Docker image — both with "An error occurred in `next/font`" out of
// google/loader.js, a release blocked by a network call unrelated to the
// release. The two woff2 files next to this file are the same latin-subset
// variable fonts that loader was downloading, so the browser gets identical
// bytes; see fonts/README.md.
const inter = localFont({
  src: "./fonts/Inter-latin-variable.woff2",
  // The file's real axis. Claiming a wider range than the font carries makes
  // the browser synthesise the missing weights instead of refusing them.
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

// Space Grotesk is the Kodelyth brand display font. Used for the kRouter
// wordmark in the sidebar + login page. One variable file covers the 500/600/700
// the wordmark asks for, so the same family drives medium-weight UI labels and
// bold marks without three separate static cuts.
const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk-latin-variable.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata = {
  title: "kRouter — Kodelyth AI Infrastructure",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly. By Kodelyth.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint. ThemeProvider only calls
            applyTheme() from an effect, so until React hydrated every reload painted
            the light theme first and dark-mode users saw a white flash. Mirrors the
            zustand-persist "theme" key and the `dark` class applyTheme() sets. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var t=s?(JSON.parse(s).state||{}).theme:'system';t=t||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t==='system'&&m)){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      {/* suppressHydrationWarning silences the one-level mismatch caused by browser
          extensions (Grammarly, LastPass, ColorZilla, etc.) that inject attributes
          like `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` into <body>
          before React hydrates. The mismatch is cosmetic — React ignores the
          unknown attributes — but the dev overlay surfaces a noisy warning we
          can't act on (it's the user's extension, not our code). Matches the
          same prop already on <html> above. */}
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
