import { NextResponse } from "next/server";
import axios from "axios";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = body.url;
    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    const response = await axios.get(url);
    return new NextResponse(response.data, {
      headers: { "Content-Type": "text/html" }
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to fetch response sheet from the URL." }, { status: 500 });
  }
}
