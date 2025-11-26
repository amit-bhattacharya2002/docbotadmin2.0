"use client";

import { useEffect, useRef, useState } from "react";
import { GeneratedFaqItem } from "@/app/types/faq";

type Props = {
  companyName: string;
  departmentName: string;
};

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11);

const createEmptyFAQ = (): GeneratedFaqItem => ({
  id: makeId(),
  question: "",
  answer: "",
});

type CrawlMeta = {
  pagesVisited: number;
  pagesCollected: number;
};

export default function FAQGeneratorPanel({ companyName, departmentName }: Props) {
  const [url, setUrl] = useState("");
  const [faqs, setFaqs] = useState<GeneratedFaqItem[]>([]);
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [crawlMeta, setCrawlMeta] = useState<CrawlMeta | null>(null);
  const aiStatusTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (aiStatusTimeout.current) {
        clearTimeout(aiStatusTimeout.current);
      }
    };
  }, []);

  const handleScrape = async () => {
    if (!url) {
      setError("Please enter a URL to scan.");
      return;
    }

    setScraping(true);
    setError(null);
    setMessage("Crawling website...");
    setProgressLog(["Starting crawl..."]);
    setCrawlMeta(null);
    if (aiStatusTimeout.current) {
      clearTimeout(aiStatusTimeout.current);
    }
    aiStatusTimeout.current = setTimeout(() => {
      setMessage("Generating FAQs with AI...");
    }, 2500);
    try {
      const response = await fetch("/api/faq-scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to scrape the website.");
      }
      const extracted: GeneratedFaqItem[] = (data.faqs || []).map((item: GeneratedFaqItem) => ({
        id: item.id || makeId(),
        question: item.question ?? "",
        answer: item.answer ?? "",
        sourceUrl: item.sourceUrl ?? url,
      }));
      setFaqs(extracted.length ? extracted : [createEmptyFAQ()]);
      setProgressLog(data.meta?.progressLog ?? []);
      setCrawlMeta(
        data.meta
          ? {
              pagesVisited: data.meta.pagesVisited ?? 0,
              pagesCollected: data.meta.pagesCollected ?? 0,
            }
          : null
      );
      setMessage(
        data.message ??
          (extracted.length
            ? `Generated ${extracted.length} FAQ entries.`
            : "No FAQ content detected. Add entries manually.")
      );
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to scrape the website.");
    } finally {
      setScraping(false);
      if (aiStatusTimeout.current) {
        clearTimeout(aiStatusTimeout.current);
      }
    }
  };

  const handleFaqChange = (id: string, field: "question" | "answer", value: string) => {
    setFaqs((prev) =>
      prev.map((faq) => (faq.id === id ? { ...faq, [field]: value } : faq))
    );
  };

  const addFaq = () => {
    setFaqs((prev) => [...prev, createEmptyFAQ()]);
  };

  const removeFaq = (id: string) => {
    setFaqs((prev) => prev.filter((faq) => faq.id !== id));
  };

  const handleDownload = async () => {
    if (!faqs.length || faqs.every((faq) => !faq.question && !faq.answer)) {
      setError("Add at least one FAQ entry before downloading.");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch("/api/faq-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${companyName} - ${departmentName} FAQ`,
          faqs: faqs.map(({ question, answer }) => ({ question, answer })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to generate DOCX.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${companyName.replace(/\s+/g, "_")}_${departmentName.replace(
        /\s+/g,
        "_"
      )}_FAQ.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to download DOCX.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Left: Scraper */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4">
          <div>
            <h3 className="text-xl font-semibold text-white">Scan Website</h3>
            <p className="text-sm text-gray-300">Enter a public URL to generate FAQ suggestions.</p>
          </div>
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="px-4 py-3 rounded-lg bg-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {scraping ? "Scanning..." : "Scan Website"}
          </button>
          {crawlMeta && (
            <div className="text-xs text-gray-300">
              Crawled {crawlMeta.pagesCollected} / {crawlMeta.pagesVisited} pages
            </div>
          )}
          {message && <div className="text-xs text-green-400">{message}</div>}
          {error && <div className="text-xs text-red-400">{error}</div>}
          {progressLog.length > 0 && (
            <div className="text-xs text-gray-400 bg-black/40 rounded-lg p-3 max-h-48 overflow-y-auto border border-white/10">
              <div className="font-semibold text-white mb-2">Progress</div>
              <ul className="space-y-1 list-disc list-inside">
                {progressLog.map((log, idx) => (
                  <li key={`${log}-${idx}`}>{log}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right: Editor */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-semibold text-white">FAQ Editor</h3>
              <p className="text-sm text-gray-300">Modify questions and answers before exporting.</p>
            </div>
            <button
              onClick={addFaq}
              className="px-3 py-1 rounded-lg border border-white/20 text-white text-sm hover:bg-white/10 transition-colors"
            >
              + Add Entry
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {faqs.length === 0 && (
              <div className="text-sm text-gray-400">
                No FAQ entries yet. Scan a website or add entries manually.
              </div>
            )}
            {faqs.map((faq, idx) => (
              <div key={faq.id} className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>FAQ {idx + 1}</span>
                  <button
                    onClick={() => removeFaq(faq.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remove
                  </button>
                </div>
                <input
                  value={faq.question}
                  onChange={(e) => handleFaqChange(faq.id, "question", e.target.value)}
                  placeholder="Question"
                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <textarea
                  value={faq.answer}
                  onChange={(e) => handleFaqChange(faq.id, "answer", e.target.value)}
                  placeholder="Answer"
                  rows={4}
                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            ))}
          </div>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="mt-4 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {downloading ? "Preparing Download..." : "Download as DOCX"}
          </button>
        </div>
      </div>
    </div>
  );
}

