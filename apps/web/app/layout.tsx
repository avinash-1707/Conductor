import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SmoothScroll } from "../components/landing/smooth-scroll";
import { Providers } from "./providers";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Set the saved theme before paint so there is no light/dark flash on load.
const themeScript = `(function(){try{var t=localStorage.getItem("conductor-theme");if(t==="light"){document.documentElement.classList.add("light");}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Conductor · Run AI pipelines you can trust",
  description:
    "Conductor runs your content and SEO pipelines end to end. They survive crashes, pause for a human when it matters, and finish without anyone watching.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <SmoothScroll />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
