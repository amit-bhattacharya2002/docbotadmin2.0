import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import crypto from "crypto";
import { GeneratedFaqItem } from "@/app/types/faq";

const MAX_PAGES = 50;
const MAX_TOTAL_CHARACTERS = 60_000;
const MAX_PAGE_CHARACTERS = 2_000;
const USER_AGENT = "Docbot-FAQ-Crawler/1.0 (+https://meaningfulinnovations.org)";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type CrawlResult = {
  text: string;
  url: string;
};

type CrawlMeta = {
  pagesVisited: number;
  pagesCollected: number;
  progressLog: string[];
};

const cleanWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const isSameOrigin = (base: URL, candidate: string) => {
  try {
    const candidateUrl = new URL(candidate, base);
    return candidateUrl.origin === base.origin;
  } catch {
    return false;
  }
};

const removeUnwantedNodes = ($: cheerio.CheerioAPI) => {
  ["script", "style", "nav", "header", "footer", "noscript"].forEach((selector) => {
    $(selector).remove();
  });
};

const extractTextAndLinks = (html: string, baseUrl: URL) => {
  const $ = cheerio.load(html);
  removeUnwantedNodes($);
  const text = cleanWhitespace($("body").text());
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (isSameOrigin(baseUrl, absolute)) {
        links.push(absolute.split("#")[0]);
      }
    } catch {
      // ignore malformed URLs
    }
  });

  return { text, links };
};

async function fetchPage(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (status: ${response.status})`);
  }

  return response.text();
}

async function crawlSite(startUrl: URL): Promise<{ pages: CrawlResult[]; meta: CrawlMeta }> {
  const queue: string[] = [startUrl.toString()];
  const visited = new Set<string>();
  const collected: CrawlResult[] = [];
  const progressLog: string[] = [];

  while (queue.length && collected.length < MAX_PAGES) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      progressLog.push(`Fetching ${current}`);
      const html = await fetchPage(current);
      const { text, links } = extractTextAndLinks(html, startUrl);
      if (text) {
        collected.push({
          url: current,
          text: text.slice(0, MAX_PAGE_CHARACTERS),
        });
        progressLog.push(`Captured content from ${current}`);
      } else {
        progressLog.push(`Skipped ${current} (no readable text)`);
      }

      for (const link of links) {
        if (!visited.has(link) && queue.length + visited.size < MAX_PAGES * 2) {
          queue.push(link);
        }
      }
    } catch (error: any) {
      progressLog.push(`Failed to fetch ${current}: ${error.message}`);
    }
  }

  return {
    pages: collected,
    meta: {
      pagesVisited: visited.size,
      pagesCollected: collected.length,
      progressLog,
    },
  };
}

function buildPrompt(text: string) {
  return `
You are an expert knowledge base writer.
Generate helpful Frequently Asked Questions from the provided website content.

Requirements:
- Provide between 10 and 30 FAQ entries.
- Each entry must contain a concise question and a clear answer.
- Answers should be factual and based only on the provided content.
- Respond with pure JSON array (no backticks) using the format:
[
  { "question": "Question?", "answer": "Answer." }
]

Website content:
"""
${text}
"""
`.trim();
}

function parseFaqResponse(content?: string | null): { question: string; answer: string }[] {
  if (!content) return [];
  const trimmed = content.trim();
  const jsonStart = trimmed.indexOf("[");
  const jsonEnd = trimmed.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item) => typeof item?.question === "string" && typeof item?.answer === "string"
      );
    }
    return [];
  } catch (error) {
    console.error("Failed to parse FAQ JSON", error);
    return [];
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { message: "OpenAI API key is not configured on the server." },
      { status: 500 }
    );
  }

  try {
    const { url }: { url?: string } = await req.json();
    if (!url) {
      return NextResponse.json({ message: "Missing url in request body." }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(url);
    } catch {
      return NextResponse.json({ message: "Invalid url provided." }, { status: 400 });
    }

    const { pages, meta } = await crawlSite(targetUrl);
    if (pages.length === 0) {
      return NextResponse.json(
        {
          message: "Unable to extract readable content from the provided site.",
          faqs: [],
          meta,
        },
        { status: 200 }
      );
    }

    const aggregatedText = pages
      .map((page) => `Source: ${page.url}\n${page.text}`)
      .join("\n\n---\n\n")
      .slice(0, MAX_TOTAL_CHARACTERS);

    meta.progressLog.push(
      `Collected ${pages.length} page(s). Sending ${aggregatedText.length} characters to OpenAI.`
    );

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You create FAQ style Q&A pairs for higher-education websites. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: buildPrompt(aggregatedText),
        },
      ],
    });

    const faqs = parseFaqResponse(completion.choices[0]?.message?.content).map<GeneratedFaqItem>(
      (item) => ({
        id: crypto.randomUUID(),
        question: cleanWhitespace(item.question),
        answer: cleanWhitespace(item.answer),
        sourceUrl: targetUrl.toString(),
      })
    );

    if (faqs.length === 0) {
      return NextResponse.json(
        {
          message:
            "The AI could not generate FAQs from the provided content. Try a different page or add FAQs manually.",
          faqs: [],
          meta,
        },
        { status: 200 }
      );
    }

    meta.progressLog.push(`Generated ${faqs.length} FAQs with AI.`);

    return NextResponse.json({
      faqs,
      meta,
    });
  } catch (error: any) {
    console.error("FAQ scraper error", error);
    return NextResponse.json(
      { message: error?.message || "Failed to process request." },
      { status: 500 }
    );
  }
}

