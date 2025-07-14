import type { Metadata } from "next";
import { Inter, Noto_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: '--font-inter',
  display: 'swap',
});

const noto = Noto_Sans({
  subsets: ["latin"],
  variable: '--font-noto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Docbot Admin",
  description: "Document management and knowledge base system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${noto.variable}`}>
      <body className="font-sans">
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex flex-col">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
