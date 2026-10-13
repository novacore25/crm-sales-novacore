import { NextResponse } from 'next/server';
import { saveScrapedBatch } from '@/app/actions/scraped-lead-actions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

// Handle Preflight OPTIONS request dari browser
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// Handle POST request untuk menerima leads dari Bookmarklet
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items = body.items || [];
    const scrapedBy = body.scrapedBy || body.user || 'Bookmarklet';

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Tidak ada data items yang dikirim' },
        { status: 400, headers: corsHeaders },
      );
    }

    const result = await saveScrapedBatch(items, scrapedBy);

    return NextResponse.json(
      {
        success: true,
        total: result.total,
        inserted: result.inserted,
        skipped: result.skipped,
        message: `${result.inserted} leads baru disimpan ke penampungan (${result.skipped} duplikat dilewati).`,
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500, headers: corsHeaders },
    );
  }
}
