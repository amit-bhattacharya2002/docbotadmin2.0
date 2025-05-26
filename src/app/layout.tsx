import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ 
  subsets: ["latin"],
  variable: '--font-geist'
});

const geistMono = Geist_Mono({ 
  subsets: ["latin"],
  variable: '--font-geist-mono'
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
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} font-mono`}>
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex flex-col [&>h1]:font-geist [&>h2]:font-geist [&>h3]:font-geist [&>h4]:font-geist [&>h5]:font-geist [&>h6]:font-geist">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
