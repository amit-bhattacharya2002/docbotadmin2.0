import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

type FAQItem = {
  question: string;
  answer: string;
};

const safeFilename = (name: string) =>
  name
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "docbot_faq";

export async function POST(req: NextRequest) {
  try {
    const { faqs, title }: { faqs?: FAQItem[]; title?: string } = await req.json();

    if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
      return NextResponse.json({ message: "No FAQ entries provided." }, { status: 400 });
    }

    const docTitle = title?.trim() || "Generated FAQ";

    const children: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: docTitle,
            bold: true,
            size: 32,
          }),
        ],
        spacing: { after: 300 },
      }),
    ];

    faqs.forEach((item, idx) => {
      if (!item.question || !item.answer) return;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${idx + 1}. ${item.question}`,
              bold: true,
              size: 26,
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: item.answer,
              size: 24,
            }),
          ],
          spacing: { after: 200 },
        })
      );
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${safeFilename(docTitle)}.docx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("FAQ DOCX generation error", error);
    return NextResponse.json({ message: "Failed to generate document." }, { status: 500 });
  }
}


