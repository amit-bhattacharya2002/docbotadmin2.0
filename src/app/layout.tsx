import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600", // Semibold
  variable: '--font-montserrat',
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
    <html lang="en" className={montserrat.variable}>
      <body className="font-montserrat antialiased">
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex flex-col">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
